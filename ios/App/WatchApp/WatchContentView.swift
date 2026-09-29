import SwiftUI
import WatchKit

struct WatchContentView: View {
    @StateObject private var manager = HeartRateWorkoutManager()
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
                        Text(String(format: "%+.0f 相对本次基线", delta))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    } else {
                        Text(manager.isRunning ? "保持相对静止以建立基线" : "开始后读取实时心率")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("实时心率")
                .accessibilityValue(manager.bpm.map { "每分钟 \(Int($0.rounded())) 次" } ?? "暂无数据")

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
                        manager.isRunning ? "结束测量" : "开始测量",
                        systemImage: manager.isRunning ? "stop.fill" : "play.fill"
                    )
                    .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.borderedProminent)
                .tint(manager.isRunning ? .red : .mint)
                .disabled(manager.signalState == .requestingAccess)
                .accessibilityHint(manager.isRunning ? "结束本次实时信号采集" : "请求权限并开始采集实时信号")

                Button(action: openCheckIn) {
                    Label("记录焦虑", systemImage: "square.and.pencil")
                        .frame(maxWidth: .infinity, minHeight: 30)
                }
                .buttonStyle(.bordered)
                .accessibilityHint("临时打开焦虑自评，完成后返回实时心率")
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
        case ..<0.06: return "静止"
        case ..<0.16: return "轻微"
        default: return "活动中"
        }
    }
}

private struct CheckInView: View {
    @ObservedObject var manager: HeartRateWorkoutManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 8) {
            Text("此刻有多焦虑？")
                .font(.headline)
                .multilineTextAlignment(.center)

            Text("\(Int(manager.draftRating.rounded()))")
                .font(.system(size: 50, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(ratingColor)
                .contentTransition(.numericText())

            Text("转动表冠 · 0 不焦虑，10 非常焦虑")
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
                .accessibilityLabel("取消")

                Button {
                    manager.saveCheckIn()
                    WKInterfaceDevice.current().play(.success)
                    dismiss()
                } label: {
                    Label("记录", systemImage: "checkmark")
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
        .accessibilityLabel("当下焦虑自评")
    }

    private var ratingColor: Color {
        switch manager.draftRating {
        case ..<4: return .mint
        case ..<7: return .yellow
        default: return .orange
        }
    }
}
