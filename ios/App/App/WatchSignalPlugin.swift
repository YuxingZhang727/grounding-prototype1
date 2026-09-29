import Capacitor
import Foundation
import WatchConnectivity

/// Receives live sensor snapshots and self-reported check-ins from the
/// companion watchOS target, then exposes them to the Capacitor web layer.
@objc(WatchSignalPlugin)
final class WatchSignalPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "WatchSignalPlugin"
    let jsName = "WatchSignal"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLatest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCheckIns", returnType: CAPPluginReturnPromise)
    ]

    private let receiver = WatchSignalReceiver.shared

    override func load() {
        receiver.onMessage = { [weak self] event, payload in
            DispatchQueue.main.async {
                // Check-ins are durable events. Live telemetry is replaceable
                // and must never build a backlog in the Capacitor bridge.
                self?.notifyListeners(
                    event,
                    data: payload,
                    retainUntilConsumed: event == "checkIn"
                )
            }
        }
        receiver.activate()
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(receiver.availability)
    }

    @objc func getLatest(_ call: CAPPluginCall) {
        call.resolve(receiver.latestSnapshot ?? ["available": false])
    }

    @objc func getCheckIns(_ call: CAPPluginCall) {
        call.resolve(["entries": receiver.checkIns])
    }
}

private final class WatchSignalReceiver: NSObject, WCSessionDelegate {
    static let shared = WatchSignalReceiver()

    var onMessage: ((String, [String: Any]) -> Void)?

    private(set) var latestSnapshot: [String: Any]?
    private(set) var checkIns: [[String: Any]] = []
    private var lastSnapshotPersistedAt = Date.distantPast

    var availability: [String: Any] {
        guard WCSession.isSupported() else {
            return [
                "available": false,
                "activated": false,
                "paired": false,
                "watchAppInstalled": false,
                "reachable": false
            ]
        }
        let session = WCSession.default
        let activated = session.activationState == .activated
        return [
            "available": true,
            "activated": activated,
            // Apple documents these values as valid only after activation.
            "paired": activated && session.isPaired,
            "watchAppInstalled": activated && session.isWatchAppInstalled,
            "reachable": activated && session.isReachable
        ]
    }

    private override init() {
        super.init()
        latestSnapshot = UserDefaults.standard.dictionary(forKey: Self.latestKey)
        checkIns = UserDefaults.standard.array(forKey: Self.checkInsKey) as? [[String: Any]] ?? []
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    private func receive(_ message: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if message["kind"] as? String == "checkIn" {
                self.storeCheckIn(message)
            } else {
                self.latestSnapshot = message
                let now = Date()
                let sessionStopped = message["isRunning"] as? Bool == false
                if sessionStopped || now.timeIntervalSince(self.lastSnapshotPersistedAt) >= 5 {
                    UserDefaults.standard.set(message, forKey: Self.latestKey)
                    self.lastSnapshotPersistedAt = now
                }
                self.onMessage?("signalUpdate", message)
            }
        }
    }

    private func storeCheckIn(_ message: [String: Any]) {
        if let id = message["id"] as? String {
            checkIns.removeAll { $0["id"] as? String == id }
        }
        checkIns.insert(message, at: 0)
        checkIns = Array(checkIns.prefix(100))
        UserDefaults.standard.set(checkIns, forKey: Self.checkInsKey)
        onMessage?("checkIn", message)
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        emitAvailability()
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        emitAvailability()
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        emitAvailability()
    }

    private func emitAvailability() {
        onMessage?("availabilityChanged", availability)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        receive(message)
    }

    func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        receive(applicationContext)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        receive(userInfo)
    }

    private static let latestKey = "watch-signal-latest-v1"
    private static let checkInsKey = "watch-signal-check-ins-v1"
}
