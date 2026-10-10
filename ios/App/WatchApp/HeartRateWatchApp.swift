import HealthKit
import SwiftUI
import WatchKit

final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        Task { @MainActor in
            await HeartRateWorkoutManager.shared.requestAccessAndStart(configuration: workoutConfiguration)
        }
    }
}

@main
struct HeartRateWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            WatchContentView()
        }
    }
}
