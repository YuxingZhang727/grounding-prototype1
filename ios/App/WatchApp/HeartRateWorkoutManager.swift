import CoreMotion
import Foundation
import HealthKit
import WatchConnectivity

struct AnxietyCheckIn: Codable, Identifiable, Sendable {
    let id: UUID
    let rating: Int
    let timestamp: Date
    let bpm: Double?
    let motionIntensity: Double
}

@MainActor
final class HeartRateWorkoutManager: NSObject, ObservableObject {
    static let shared = HeartRateWorkoutManager()
    enum SignalState: Equatable {
        case ready
        case requestingAccess
        case calibrating
        case typical
        case elevated
        case moving
        case unavailable(String)

        var title: String {
            switch self {
            case .ready: return "Ready to start"
            case .requestingAccess: return "Requesting access"
            case .calibrating: return "Building baseline"
            case .typical: return "Near session baseline"
            case .elevated: return "Above session baseline"
            case .moving: return "Movement detected"
            case .unavailable(let message): return message
            }
        }
    }

    @Published private(set) var bpm: Double?
    @Published private(set) var baselineBPM: Double?
    @Published private(set) var motionIntensity = 0.0
    @Published private(set) var elapsedTime: TimeInterval = 0
    @Published private(set) var isRunning = false
    @Published private(set) var isPhoneReachable = false
    @Published private(set) var signalState: SignalState = .ready
    @Published private(set) var checkIns: [AnxietyCheckIn] = []
    @Published var draftRating = 5.0

    var deltaBPM: Double? {
        guard let bpm, let baselineBPM else { return nil }
        return bpm - baselineBPM
    }

    private let healthStore = HKHealthStore()
    private let motionManager = CMMotionManager()
    private let connectivity = WatchSignalSender()
    private var workoutSession: HKWorkoutSession?
    private var workoutBuilder: HKLiveWorkoutBuilder?
    private var elapsedTask: Task<Void, Never>?
    private var startedAt: Date?
    private var baselineSamples: [Double] = []
    private var lastSnapshotSentAt = Date.distantPast
    private var isCalibrationSession = false
    private var calibrationStopScheduled = false

    override init() {
        super.init()
        checkIns = Self.loadCheckIns()
        connectivity.onReachabilityChanged = { [weak self] reachable in
            Task { @MainActor [weak self] in
                self?.isPhoneReachable = reachable
            }
        }
        connectivity.onMeasurementCommand = { [weak self] command in
            Task { @MainActor [weak self] in
                if command == "startMeasurement" {
                    self?.isCalibrationSession = false
                    await self?.requestAccessAndStart()
                } else if command == "startCalibration" {
                    self?.isCalibrationSession = true
                    await self?.requestAccessAndStart()
                } else if command == "stopMeasurement" {
                    self?.stop()
                }
            }
        }
        connectivity.activate()
    }

    deinit {
        elapsedTask?.cancel()
        motionManager.stopDeviceMotionUpdates()
    }

    func requestAccessAndStart() async {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .mindAndBody
        configuration.locationType = .indoor
        await requestAccessAndStart(configuration: configuration)
    }

    func requestAccessAndStart(configuration: HKWorkoutConfiguration) async {
        guard !isRunning else { return }
        guard HKHealthStore.isHealthDataAvailable(),
              let heartRate = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            signalState = .unavailable("Health data is unavailable")
            return
        }

        signalState = .requestingAccess
        do {
            try await healthStore.requestAuthorization(
                toShare: [HKObjectType.workoutType()],
                read: [heartRate]
            )
            try startWorkout(configuration: configuration)
        } catch {
            signalState = .unavailable("Health access is required")
        }
    }

    private func startWorkout(configuration: HKWorkoutConfiguration) throws {
        baselineSamples.removeAll(keepingCapacity: true)
        baselineBPM = nil
        bpm = nil
        elapsedTime = 0
        calibrationStopScheduled = false

        let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
        let builder = session.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(
            healthStore: healthStore,
            workoutConfiguration: configuration
        )
        session.delegate = self
        builder.delegate = self
        workoutSession = session
        workoutBuilder = builder

        let start = Date()
        startedAt = start
        session.startActivity(with: start)
        builder.beginCollection(withStart: start) { [weak self] success, _ in
            Task { @MainActor in
                guard let self else { return }
                guard success else {
                    self.signalState = .unavailable("Measurement could not start")
                    return
                }
                self.isRunning = true
                self.signalState = .calibrating
                self.startMotionUpdates()
                self.startElapsedClock()
                self.sendSnapshot(force: true)
            }
        }
    }

    func stop() {
        guard isRunning || workoutSession != nil else { return }
        let end = Date()
        elapsedTask?.cancel()
        elapsedTask = nil
        motionManager.stopDeviceMotionUpdates()
        workoutSession?.end()
        let builder = workoutBuilder
        builder?.endCollection(withEnd: end) { _, _ in
            builder?.discardWorkout()
        }
        workoutSession = nil
        workoutBuilder = nil
        startedAt = nil
        isRunning = false
        isCalibrationSession = false
        calibrationStopScheduled = false
        motionIntensity = 0
        signalState = .ready
        sendSnapshot(force: true)
    }

    func saveCheckIn() {
        let entry = AnxietyCheckIn(
            id: UUID(),
            rating: Int(draftRating.rounded()),
            timestamp: Date(),
            bpm: bpm,
            motionIntensity: motionIntensity
        )
        checkIns.insert(entry, at: 0)
        checkIns = Array(checkIns.prefix(30))
        if let data = try? JSONEncoder().encode(checkIns) {
            UserDefaults.standard.set(data, forKey: Self.checkInStorageKey)
        }
        connectivity.sendCheckIn(entry)
    }

    private func startElapsedClock() {
        elapsedTask?.cancel()
        elapsedTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard let self, let startedAt = self.startedAt else { continue }
                self.elapsedTime = Date().timeIntervalSince(startedAt)
                self.sendSnapshot()
            }
        }
    }

    private func startMotionUpdates() {
        guard motionManager.isDeviceMotionAvailable else { return }
        // Gross wrist-motion context does not need screen-refresh frequency.
        // Four samples per second keeps the signal useful without forcing
        // SwiftUI to redraw the entire watch face ten times per second.
        motionManager.deviceMotionUpdateInterval = 0.25
        let queue = OperationQueue()
        queue.qualityOfService = .userInitiated
        motionManager.startDeviceMotionUpdates(to: queue) { [weak self] motion, _ in
            guard let motion else { return }
            let acceleration = motion.userAcceleration
            let magnitude = sqrt(
                acceleration.x * acceleration.x
                + acceleration.y * acceleration.y
                + acceleration.z * acceleration.z
            )
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.motionIntensity = (self.motionIntensity * 0.82) + (min(magnitude, 2) * 0.18)
                self.updateSignalState()
            }
        }
    }

    private func processHeartRate(_ value: Double) {
        let isFirstReading = bpm == nil
        bpm = value
        if motionIntensity < 0.12, baselineSamples.count < 8 {
            baselineSamples.append(value)
            if baselineSamples.count >= 5 {
                baselineBPM = baselineSamples.sorted()[baselineSamples.count / 2]
            }
        }
        updateSignalState()
        if isCalibrationSession, baselineSamples.count >= 5, !calibrationStopScheduled {
            calibrationStopScheduled = true
            sendSnapshot(force: true)
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(1))
                guard let self, self.isRunning, self.isCalibrationSession else { return }
                self.stop()
            }
            return
        }
        // The first sensor value should reach the phone immediately instead of
        // waiting for the regular one-second telemetry cadence.
        sendSnapshot(force: isFirstReading)
    }

    private func updateSignalState() {
        guard isRunning else { return }
        if motionIntensity >= 0.12 {
            signalState = .moving
        } else if baselineBPM == nil {
            signalState = .calibrating
        } else if let deltaBPM, deltaBPM >= 10 {
            signalState = .elevated
        } else {
            signalState = .typical
        }
    }

    private func sendSnapshot(force: Bool = false) {
        let now = Date()
        guard force || now.timeIntervalSince(lastSnapshotSentAt) >= 0.9 else { return }
        lastSnapshotSentAt = now
        connectivity.sendSnapshot(
            bpm: bpm,
            baselineBPM: baselineBPM,
            baselineSampleCount: min(baselineSamples.count, 5),
            baselineTarget: 5,
            motionIntensity: motionIntensity,
            elapsedTime: elapsedTime,
            isRunning: isRunning,
            status: signalState.title
        )
    }

    private static let checkInStorageKey = "anxiety-check-ins-v1"

    private static func loadCheckIns() -> [AnxietyCheckIn] {
        guard let data = UserDefaults.standard.data(forKey: checkInStorageKey),
              let entries = try? JSONDecoder().decode([AnxietyCheckIn].self, from: data) else {
            return []
        }
        return entries
    }
}

extension HeartRateWorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilder(
        _ workoutBuilder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        guard let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate),
              collectedTypes.contains(heartRateType),
              let quantity = workoutBuilder.statistics(for: heartRateType)?.mostRecentQuantity() else {
            return
        }
        let value = quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        Task { @MainActor [weak self] in self?.processHeartRate(value) }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}

extension HeartRateWorkoutManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {}

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor [weak self] in
            self?.isRunning = false
            self?.signalState = .unavailable("Measurement was interrupted")
        }
    }
}

private final class WatchSignalSender: NSObject, WCSessionDelegate {
    var onReachabilityChanged: ((Bool) -> Void)?
    var onMeasurementCommand: ((String) -> Void)?
    private let snapshotLock = NSLock()
    private var latestSnapshot: [String: Any]?
    private var hasPhoneReceipt = false

    func activate() {
        guard WCSession.isSupported() else {
            onReachabilityChanged?(false)
            return
        }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func sendSnapshot(
        bpm: Double?,
        baselineBPM: Double?,
        baselineSampleCount: Int,
        baselineTarget: Int,
        motionIntensity: Double,
        elapsedTime: TimeInterval,
        isRunning: Bool,
        status: String
    ) {
        var message: [String: Any] = [
            "kind": "snapshot",
            "provider": "apple_watch",
            "baselineSampleCount": baselineSampleCount,
            "baselineTarget": baselineTarget,
            "motionIntensity": motionIntensity,
            "elapsedTime": elapsedTime,
            "isRunning": isRunning,
            "status": status,
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ]
        if let bpm {
            // Keep the concise key for existing builds and include an explicit
            // alias so the Capacitor boundary can recover across bridge types.
            message["bpm"] = NSNumber(value: bpm)
            message["heartRateBPM"] = NSNumber(value: bpm)
            message["bpmText"] = String(format: "%.3f", bpm)
        }
        if let baselineBPM { message["baselineBPM"] = baselineBPM }
        snapshotLock.lock()
        latestSnapshot = message
        snapshotLock.unlock()
        send(message)
    }

    func sendCheckIn(_ entry: AnxietyCheckIn) {
        var message: [String: Any] = [
            "kind": "checkIn",
            "id": entry.id.uuidString,
            "rating": entry.rating,
            "motionIntensity": entry.motionIntensity,
            "timestamp": ISO8601DateFormatter().string(from: entry.timestamp)
        ]
        if let bpm = entry.bpm { message["bpm"] = bpm }
        guard WCSession.isSupported() else { return }
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(message, replyHandler: nil, errorHandler: nil)
        } else {
            WCSession.default.transferUserInfo(message)
        }
    }

    private func send(_ message: [String: Any]) {
        guard WCSession.isSupported() else { return }
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(message, replyHandler: nil) { [weak self] _ in
                // Reachability can change between the check and transmission.
                // Keep the newest state available for opportunistic delivery.
                try? WCSession.default.updateApplicationContext(message)
                self?.onReachabilityChanged?(WCSession.default.isReachable)
            }
        } else {
            try? WCSession.default.updateApplicationContext(message)
        }
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        reportPhoneLink(session)
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        reportPhoneLink(session)
        guard session.isReachable else { return }
        snapshotLock.lock()
        let snapshot = latestSnapshot
        snapshotLock.unlock()
        if let snapshot {
            session.sendMessage(snapshot, replyHandler: nil, errorHandler: nil)
        }
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        if message["kind"] as? String == "measurementCommand",
           let command = message["command"] as? String {
            onMeasurementCommand?(command)
            replyHandler(["accepted": true])
            return
        }
        guard message["kind"] as? String == "requestSnapshot" else {
            replyHandler(["available": false])
            return
        }
        snapshotLock.lock()
        let snapshot = latestSnapshot
        snapshotLock.unlock()
        replyHandler(snapshot ?? ["available": false])
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        acceptPhoneMessage(message, session: session)
    }

    func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        acceptPhoneMessage(applicationContext, session: session)
    }

    private func acceptPhoneMessage(_ message: [String: Any], session: WCSession) {
        if message["kind"] as? String == "measurementCommand",
           let command = message["command"] as? String {
            onMeasurementCommand?(command)
        } else if message["kind"] as? String == "snapshotReceipt" {
            hasPhoneReceipt = true
            reportPhoneLink(session)
        }
    }

    private func reportPhoneLink(_ session: WCSession) {
        onReachabilityChanged?(hasPhoneReceipt || session.isReachable)
    }
}
