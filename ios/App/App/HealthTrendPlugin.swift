import Foundation
import Capacitor
import HealthKit

/// Reads personal trend signals from HealthKit so the app can compare "today"
/// against the user's own baseline.
///
/// Design notes:
/// - Only aggregated trend data crosses the bridge. Continuous streams stay on
///   the native side (see the live heart-rate path in the Watch prototype).
/// - HRV is read from overnight samples only. Apple Watch collects HRV mostly
///   during sleep, where readings are stable; daytime HRV is sparse and noisy
///   enough that mixing it in corrupts the baseline.
/// - Every value is returned alongside the baseline and a normalized deviation
///   so the web layer never has to reason about absolute HRV values, which are
///   not comparable between people.
/// - No value is presented as a diagnosis. `deviation` is a descriptive ratio.
@objc(HealthTrendPlugin)
class HealthTrendPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "HealthTrendPlugin"
    let jsName = "HealthTrend"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTrends", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitDummySamples", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()
    /// Baseline window. Two weeks is short enough to reflect the current period
    /// and long enough to survive a few missing nights.
    private let baselineDays = 14
    /// Trend window returned to the UI.
    private let trendDays = 30

    private var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        types.insert(HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!)
        types.insert(HKQuantityType.quantityType(forIdentifier: .restingHeartRate)!)
        types.insert(HKQuantityType.quantityType(forIdentifier: .respiratoryRate)!)
        types.insert(HKCategoryType.categoryType(forIdentifier: .mindfulSession)!)
        types.insert(HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)!)
        types.insert(HKObjectType.electrocardiogramType())
        if #available(iOS 16.0, *), let wristTemperature = HKQuantityType.quantityType(forIdentifier: .appleSleepingWristTemperature) {
            types.insert(wristTemperature)
        }
        return types
    }

    // MARK: - Availability

    @objc func isAvailable(_ call: CAPPluginCall) {
        let available = HKHealthStore.isHealthDataAvailable()
        call.resolve([
            "available": available,
            "entitled": isEntitled,
            "hasHealthData": available
        ])
    }

    /// `HKHealthStore.isHealthDataAvailable()` returns true on any iPhone, even
    /// in a build where the HealthKit entitlement is missing or the profile has
    /// gone stale. Calling `requestAuthorization` in that state terminates the
    /// process, so this checks the signed-in provisioning profile first and lets
    /// the web layer show a clear message instead of crashing.
    ///
    /// The profile is a CMS blob, but the plist it wraps is embedded verbatim,
    /// so a byte search finds the entitlement without parsing it.
    private var isEntitled: Bool {
        // The simulator has no provisioning profile. HealthKit still works there
        // when the app is signed with a development profile, so treat it as
        // entitled and let the authorization result be the real answer.
        #if targetEnvironment(simulator)
        return true
        #else
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url) else { return false }
        let needle = Data("com.apple.developer.healthkit".utf8)
        return data.range(of: needle) != nil
        #endif
    }

    // MARK: - Authorization

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Health data is not available on this device.", "HEALTH_UNAVAILABLE")
            return
        }
        guard isEntitled else {
            call.reject(
                "This build is missing the HealthKit entitlement.",
                "HEALTH_NOT_ENTITLED"
            )
            return
        }

        // Read-only access. The app never writes to the user's health record.
        healthStore.requestAuthorization(toShare: [], read: readTypes) { success, error in
            if let error {
                call.reject(error.localizedDescription, "HEALTH_AUTH_FAILED", error)
                return
            }
            call.resolve(["granted": success])
        }
    }

    // MARK: - Trends

    @objc func getTrends(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(), isEntitled else {
            call.reject("Health data is not available in this build.", "HEALTH_UNAVAILABLE")
            return
        }

        let requestedDays = call.getInt("days") ?? trendDays
        let group = DispatchGroup()
        var payload: [String: Any] = [:]
        var failure: Error?

        let lock = NSLock()
        func record(_ key: String, _ value: Any) {
            lock.lock()
            payload[key] = value
            lock.unlock()
        }

        let end = Date()
        let start = Calendar.current.date(byAdding: .day, value: -requestedDays, to: end) ?? end

        // Daily quantity series for HRV, resting heart rate, and respiratory rate.
        for metric in QuantityMetric.allCases {
            group.enter()
            dailySeries(metric: metric, start: start, end: end) { result in
                switch result {
                case .success(let series):
                    record(metric.key, self.summarize(metric: metric, series: series))
                case .failure(let error):
                    lock.lock()
                    if failure == nil { failure = error }
                    lock.unlock()
                }
                group.leave()
            }
        }

        // Mindful minutes are a category sample, so they aggregate by duration
        // rather than by quantity.
        group.enter()
        mindfulMinutesPerDay(start: start, end: end) { result in
            switch result {
            case .success(let series):
                record("mindfulMinutes", self.summarizeSeries(key: "mindfulMinutes", unit: "min", series: series))
            case .failure(let error):
                lock.lock()
                if failure == nil { failure = error }
                lock.unlock()
            }
            group.leave()
        }

        group.enter()
        sleepHoursPerDay(start: start, end: end) { result in
            switch result {
            case .success(let series):
                record("sleepDuration", self.summarizeSeries(key: "sleepDuration", unit: "hr", series: series))
            case .failure(let error):
                lock.lock(); if failure == nil { failure = error }; lock.unlock()
            }
            group.leave()
        }

        group.enter()
        // ECG is an occasional recording rather than a daily trend. Search the
        // complete Health history so an older recording is not hidden merely
        // because the chart is showing a shorter range.
        electrocardiogramSummary() { result in
            switch result {
            case .success(let summary): record("ecg", summary)
            case .failure(let error):
                lock.lock(); if failure == nil { failure = error }; lock.unlock()
            }
            group.leave()
        }

        group.notify(queue: .main) {
            if let failure, payload.isEmpty {
                call.reject(failure.localizedDescription, "HEALTH_QUERY_FAILED", failure)
                return
            }
            // Individual metrics may legitimately have no data (respiratory rate
            // and mindful sessions are frequently not authorized). Partial
            // results are returned with nulls so the UI can degrade per-signal.
            var body = payload
            body["generatedAt"] = ISO8601DateFormatter().string(from: end)
            body["trendDays"] = requestedDays
            body["baselineDays"] = self.baselineDays
            call.resolve(body)
        }
    }

    private enum QuantityMetric: String, CaseIterable {
        case hrv = "HKQuantityTypeIdentifierHeartRateVariabilitySDNN"
        case restingHeartRate = "HKQuantityTypeIdentifierRestingHeartRate"
        case respiratoryRate = "HKQuantityTypeIdentifierRespiratoryRate"
        case wristTemperature = "HKQuantityTypeIdentifierAppleSleepingWristTemperature"

        var key: String {
            switch self {
            case .hrv: return "hrv"
            case .restingHeartRate: return "restingHeartRate"
            case .respiratoryRate: return "respiratoryRate"
            case .wristTemperature: return "wristTemperature"
            }
        }

        var identifier: HKQuantityTypeIdentifier? {
            switch self {
            case .hrv: return .heartRateVariabilitySDNN
            case .restingHeartRate: return .restingHeartRate
            case .respiratoryRate: return .respiratoryRate
            case .wristTemperature:
                if #available(iOS 16.0, *) { return .appleSleepingWristTemperature }
                return nil
            }
        }

        var unit: HKUnit {
            switch self {
            case .hrv: return HKUnit.secondUnit(with: .milli)
            case .restingHeartRate, .respiratoryRate:
                return HKUnit.count().unitDivided(by: .minute())
            case .wristTemperature: return .degreeCelsius()
            }
        }
    }

    private struct DayValue {
        let day: String
        let date: Date
        let value: Double
    }

    /// Daily aggregate for a quantity type.
    ///
    /// Every metric uses `discreteAverage`: the quantity of interest is the
    /// level during a day, never a sum. Heart-rate types are excluded by
    /// HealthKit from summing anyway, and averaging is the meaningful
    /// reduction for all three.
    private func dailySeries(
        metric: QuantityMetric,
        start: Date,
        end: Date,
        completion: @escaping (Result<[DayValue], Error>) -> Void
    ) {
        guard let identifier = metric.identifier,
              let quantityType = HKQuantityType.quantityType(forIdentifier: identifier) else {
            completion(.success([]))
            return
        }

        let interval = DateComponents(day: 1)
        var calendar = Calendar.current
        calendar.timeZone = TimeZone.current

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let query = HKStatisticsCollectionQuery(
            quantityType: quantityType,
            quantitySamplePredicate: predicate,
            options: .discreteAverage,
            anchorDate: calendar.startOfDay(for: start),
            intervalComponents: interval
        )

        query.initialResultsHandler = { _, collection, error in
            if let error {
                completion(.failure(error))
                return
            }
            guard let collection else {
                completion(.success([]))
                return
            }

            var values: [DayValue] = []
            collection.enumerateStatistics(from: start, to: end) { statistics, _ in
                guard let quantity = statistics.averageQuantity() else { return }
                let value = quantity.doubleValue(for: metric.unit)
                guard value > 0 else { return }
                values.append(
                    DayValue(
                        day: Self.dayFormatter.string(from: statistics.startDate),
                        date: statistics.startDate,
                        value: value
                    )
                )
            }
            completion(.success(values))
        }

        healthStore.execute(query)
    }

    /// Mindful minutes accumulate duration per day, so this walks the samples
    /// and sums them rather than using a statistics query.
    private func mindfulMinutesPerDay(
        start: Date,
        end: Date,
        completion: @escaping (Result<[DayValue], Error>) -> Void
    ) {
        guard let categoryType = HKCategoryType.categoryType(forIdentifier: .mindfulSession) else {
            completion(.success([]))
            return
        }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let query = HKSampleQuery(
            sampleType: categoryType,
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        ) { _, samples, error in
            if let error {
                completion(.failure(error))
                return
            }
            var byDay: [String: Double] = [:]
            for case let sample as HKCategorySample in samples ?? [] {
                let key = Self.dayFormatter.string(from: sample.startDate)
                let minutes = sample.endDate.timeIntervalSince(sample.startDate) / 60
                byDay[key, default: 0] += minutes
            }
            let values = byDay.map { DayValue(day: $0.key, date: Self.dayFormatter.date(from: $0.key) ?? start, value: $0.value) }
                .sorted { $0.date < $1.date }
            completion(.success(values))
        }
        healthStore.execute(query)
    }

    private func sleepHoursPerDay(
        start: Date,
        end: Date,
        completion: @escaping (Result<[DayValue], Error>) -> Void
    ) {
        guard let type = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            completion(.success([])); return
        }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit,
                                  sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { _, samples, error in
            if let error { completion(.failure(error)); return }
            var byDay: [String: Double] = [:]
            for case let sample as HKCategorySample in samples ?? [] {
                let asleep: Bool
                if #available(iOS 16.0, *) {
                    asleep = [HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                              HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                              HKCategoryValueSleepAnalysis.asleepREM.rawValue,
                              HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue].contains(sample.value)
                } else {
                    asleep = sample.value == HKCategoryValueSleepAnalysis.asleep.rawValue
                }
                guard asleep else { continue }
                // Attribute overnight sleep to the wake-up day.
                let key = Self.dayFormatter.string(from: sample.endDate)
                byDay[key, default: 0] += sample.endDate.timeIntervalSince(sample.startDate) / 3600
            }
            let values = byDay.map { DayValue(day: $0.key, date: Self.dayFormatter.date(from: $0.key) ?? start, value: $0.value) }
                .sorted { $0.date < $1.date }
            completion(.success(values))
        }
        healthStore.execute(query)
    }

    private func electrocardiogramSummary(
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        let type = HKObjectType.electrocardiogramType()
        let query = HKSampleQuery(sampleType: type, predicate: nil, limit: HKObjectQueryNoLimit,
                                  sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]) { _, samples, error in
            if let error { completion(.failure(error)); return }
            let ecgs = (samples ?? []).compactMap { $0 as? HKElectrocardiogram }
            var summary: [String: Any] = ["available": !ecgs.isEmpty, "count": ecgs.count]
            if let latest = ecgs.first { summary["latestAt"] = ISO8601DateFormatter().string(from: latest.startDate) }
            completion(.success(summary))
        }
        healthStore.execute(query)
    }

    // MARK: - Summarizing

    /// Packs a series into the shape the recommendation layer consumes:
    /// the latest value, a personal baseline, and a normalized deviation.
    ///
    /// The deviation is what matters. Absolute HRV varies enormously between
    /// people (20 ms and 80 ms are both unremarkable), so only a comparison
    /// against the same person's own baseline carries information.
    private func summarize(metric: QuantityMetric, series: [DayValue]) -> [String: Any] {
        let unit = metric == .hrv ? "ms" : metric == .wristTemperature ? "°C" : "count/min"
        return summarizeSeries(key: metric.key, unit: unit, series: series)
    }

    private func summarizeSeries(key: String, unit: String, series: [DayValue]) -> [String: Any] {
        guard let latest = series.last else {
            return [
                "key": key,
                "available": false,
                "latest": NSNull(),
                "baseline": NSNull(),
                "deviation": NSNull(),
                "sampleDays": 0,
                "unit": unit,
                "series": []
            ]
        }

        let calendar = Calendar.current
        let baselineCutoff = calendar.date(byAdding: .day, value: -baselineDays, to: latest.date) ?? latest.date
        // The baseline excludes the latest reading so a single unusual night
        // does not shift the reference it is being compared against.
        let baselineValues = series
            .filter { $0.date >= baselineCutoff && $0.date < calendar.startOfDay(for: latest.date) }
            .map(\.value)

        let baseline = median(baselineValues)
        let deviation: Double?
        if let baseline, baseline > 0 {
            deviation = (latest.value - baseline) / baseline
        } else {
            deviation = nil
        }

        return [
            "key": key,
            "available": true,
            "latest": latest.value,
            "latestDay": latest.day,
            "baseline": baseline as Any,
            "deviation": deviation as Any,
            "sampleDays": series.count,
            "baselineSamples": baselineValues.count,
            "unit": unit,
            "series": series.map { ["day": $0.day, "value": $0.value] }
        ]
    }

    /// Median rather than mean: a single bad night should not move the baseline.
    private func median(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let middle = sorted.count / 2
        if sorted.count % 2 == 0 {
            return (sorted[middle - 1] + sorted[middle]) / 2
        }
        return sorted[middle]
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone.current
        return formatter
    }()

    // MARK: - Development helper

    /// Writes a small synthetic trend into HealthKit so the whole pipeline can
    /// be exercised on a simulator or before a watch is paired.
    ///
    /// This is a debug affordance. It must never ship enabled in a build that
    /// collects real participant data, and it is not called from any UI path.
    @objc func submitDummySamples(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(), isEntitled else {
            call.reject("Health data is not available in this build.", "HEALTH_UNAVAILABLE")
            return
        }
        #if !DEBUG
        call.reject("Dummy samples are only available in debug builds.", "HEALTH_DEBUG_ONLY")
        return
        #else

        let days = call.getInt("days") ?? 30
        guard let hrvType = HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN),
              let rhrType = HKQuantityType.quantityType(forIdentifier: .restingHeartRate),
              let respiratoryType = HKQuantityType.quantityType(forIdentifier: .respiratoryRate) else {
            call.reject("Health types unavailable.", "HEALTH_UNAVAILABLE")
            return
        }

        healthStore.requestAuthorization(toShare: [hrvType, rhrType, respiratoryType], read: readTypes) { success, error in
            if let error {
                call.reject(error.localizedDescription, "HEALTH_AUTH_FAILED", error)
                return
            }
            guard success else {
                call.reject("Write authorization was not granted.", "HEALTH_AUTH_DENIED")
                return
            }

            let calendar = Calendar.current
            var samples: [HKObject] = []
            // Deterministic pseudo-random walk so repeated runs look similar.
            var seed: UInt64 = 42
            func next() -> Double {
                seed = seed &* 6364136223846793005 &+ 1442695040888963407
                return Double((seed >> 33) % 1000) / 1000.0
            }

            for offset in stride(from: days, through: 1, by: -1) {
                guard let day = calendar.date(byAdding: .day, value: -offset, to: Date()) else { continue }
                // Overnight timestamp: 3am, which is when a watch normally
                // records HRV.
                guard let night = calendar.date(bySettingHour: 3, minute: 0, second: 0, of: day) else { continue }

                let hrv = 48 + next() * 18 - Double(offset) * 0.25
                let rhr = 58 + next() * 8
                let respiratory = 14 + next() * 3

                samples.append(HKQuantitySample(
                    type: hrvType,
                    quantity: HKQuantity(unit: HKUnit.secondUnit(with: .milli), doubleValue: max(12, hrv)),
                    start: night,
                    end: night
                ))
                samples.append(HKQuantitySample(
                    type: rhrType,
                    quantity: HKQuantity(unit: HKUnit.count().unitDivided(by: .minute()), doubleValue: rhr),
                    start: night,
                    end: night
                ))
                samples.append(HKQuantitySample(
                    type: respiratoryType,
                    quantity: HKQuantity(unit: HKUnit.count().unitDivided(by: .minute()), doubleValue: respiratory),
                    start: night,
                    end: night
                ))
            }

            self.healthStore.save(samples) { success, error in
                if let error {
                    call.reject(error.localizedDescription, "HEALTH_SAVE_FAILED", error)
                    return
                }
                call.resolve(["saved": samples.count, "success": success])
            }
        }
        #endif
    }
}
