import SwiftUI
import WatchKit

struct WatchContentView: View {
    @StateObject private var manager = HeartRateWorkoutManager.shared
    @State private var isCheckInPresented = false

    var body: some View {
        LiveSignalView(manager: manager) {
            isCheckInPresented = true
        }
        .tint(.mint)
        .sheet(isPresented: $isCheckInPresented) {
            CheckInView(manager: manager)
        }
    }
}

private struct LiveSignalView: View {
    @ObservedObject var manager: HeartRateWorkoutManager
    let openCheckIn: () -> Void

    private var accent: Color {
        switch manager.signalState {
        case .elevated: return .orange
        case .moving: return .cyan
        case .unavailable: return .red
        case .typical: return .mint
        default: return .secondary
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(accent)
                        .frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                    Text(manager.signalState.title)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    Spacer(minLength: 2)

                    Image(systemName: manager.isPhoneReachable ? "iphone.radiowaves.left.and.right" : "iphone.slash")
                        .font(.caption2)
                        .foregroundStyle(manager.isPhoneReachable ? .mint : .secondary)
                        .accessibilityLabel(manager.isPhoneReachable ? "iPhone link confirmed" : "Waiting for iPhone app")
                }

                VStack(spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(manager.bpm.map { String(Int($0.rounded())) } ?? "—")
                            .font(.system(size: 44, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .contentTransition(.numericText())
                        Text("BPM")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }

                    if let delta = manager.deltaBPM {
                        Text(String(format: "%+.0f from baseline", delta))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    } else {
                        Text(manager.isRunning ? "Keep still to build baseline" : "Start to read live heart rate")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Live heart rate")
                .accessibilityValue(manager.bpm.map { "\(Int($0.rounded())) beats per minute" } ?? "No reading")

                HStack(spacing: 12) {
                    Label(durationText, systemImage: "timer")
                    Label(motionText, systemImage: "waveform.path")
                }
                .font(.caption2)
                .foregroundStyle(.secondary)

                Button {
                    if manager.isRunning {
                        manager.stop()
                    } else {
                        Task { await manager.requestAccessAndStart() }
                    }
                } label: {
                    Label(
                        manager.isRunning ? "Stop measuring" : "Start measuring",
                        systemImage: manager.isRunning ? "stop.fill" : "play.fill"
                    )
                    .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.borderedProminent)
                .tint(manager.isRunning ? .red : .mint)
                .disabled(manager.signalState == .requestingAccess)
                .accessibilityHint(manager.isRunning ? "Ends live signal collection" : "Requests permission and starts live signal collection")

                Button(action: openCheckIn) {
                    Label("Record check-in", systemImage: "square.and.pencil")
                        .frame(maxWidth: .infinity, minHeight: 30)
                }
                .buttonStyle(.bordered)
                .accessibilityHint("Opens a brief self-report and returns to live heart rate when complete")
            }
            .padding(.horizontal, 8)
        }
    }

    private var durationText: String {
        let seconds = Int(manager.elapsedTime)
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }

    private var motionText: String {
        switch manager.motionIntensity {
        case ..<0.06: return "Still"
        case ..<0.16: return "Light motion"
        default: return "Moving"
        }
    }
}

private struct CheckInView: View {
    @ObservedObject var manager: HeartRateWorkoutManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 8) {
            Text("How anxious do you feel now?")
                .font(.headline)
                .multilineTextAlignment(.center)

            Text("\(Int(manager.draftRating.rounded()))")
                .font(.system(size: 50, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(ratingColor)
                .contentTransition(.numericText())

            Text("Turn the crown · 0 not anxious, 10 very anxious")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)

            HStack(spacing: 6) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .frame(maxWidth: .infinity, minHeight: 30)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Cancel")

                Button {
                    manager.saveCheckIn()
                    WKInterfaceDevice.current().play(.success)
                    dismiss()
                } label: {
                    Label("Save", systemImage: "checkmark")
                        .frame(maxWidth: .infinity, minHeight: 30)
                }
                .buttonStyle(.borderedProminent)
                .tint(.purple)
            }
        }
        .padding(.horizontal, 8)
        .focusable()
        .digitalCrownRotation(
            $manager.draftRating,
            from: 0,
            through: 10,
            by: 1,
            sensitivity: .medium,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Current anxiety self-report")
    }

    private var ratingColor: Color {
        switch manager.draftRating {
        case ..<4: return .mint
        case ..<7: return .yellow
        default: return .orange
        }
    }
}
