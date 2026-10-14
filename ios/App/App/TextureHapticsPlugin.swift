import Foundation
import Capacitor
import CoreHaptics

private struct TextureProfile {
    let continuousIntensity: Float
    let continuousSharpness: Float
    let pulseSpacing: Double
    let pulseIntensity: Float
    let pulseSharpness: Float

    static func mixed(_ profiles: [TextureProfile]) -> TextureProfile {
        guard !profiles.isEmpty else { return profile(for: "soft") }
        let count = Float(profiles.count)
        let pulsingProfiles = profiles.filter { $0.pulseIntensity > 0 }
        let pulseSpacing = pulsingProfiles.isEmpty
            ? 10_000
            : pulsingProfiles.reduce(0) { $0 + $1.pulseSpacing } / Double(pulsingProfiles.count)
        return TextureProfile(
            continuousIntensity: profiles.reduce(0) { $0 + $1.continuousIntensity } / count,
            continuousSharpness: profiles.reduce(0) { $0 + $1.continuousSharpness } / count,
            pulseSpacing: pulseSpacing,
            pulseIntensity: profiles.reduce(0) { $0 + $1.pulseIntensity } / count,
            pulseSharpness: profiles.reduce(0) { $0 + $1.pulseSharpness } / count
        )
    }

    static func profile(for rawValue: String) -> TextureProfile {
        let value = rawValue.lowercased()
        if value.range(of: "rough|grain|grit|sand|coarse|scratch|cement|concrete", options: .regularExpression) != nil {
            return TextureProfile(continuousIntensity: 0, continuousSharpness: 0.8, pulseSpacing: 10, pulseIntensity: 0.9, pulseSharpness: 1)
        }
        if value.range(of: "smooth|silk|polish|glass|sleek", options: .regularExpression) != nil {
            return TextureProfile(continuousIntensity: 0, continuousSharpness: 0.5, pulseSpacing: 10_000, pulseIntensity: 0, pulseSharpness: 0.5)
        }
        if value.range(of: "bump|raised|knob|lump|uneven", options: .regularExpression) != nil {
            return TextureProfile(continuousIntensity: 0, continuousSharpness: 0.45, pulseSpacing: 28, pulseIntensity: 0.95, pulseSharpness: 0.62)
        }
        if value.range(of: "fuzz|fur|fluff|wool|velvet|fabric", options: .regularExpression) != nil {
            return TextureProfile(continuousIntensity: 0.13, continuousSharpness: 0.14, pulseSpacing: 20, pulseIntensity: 0.16, pulseSharpness: 0.18)
        }
        if value.range(of: "stick|tack|gum|rubber|damp", options: .regularExpression) != nil {
            return TextureProfile(continuousIntensity: 0.08, continuousSharpness: 0.04, pulseSpacing: 38, pulseIntensity: 0.68, pulseSharpness: 0.08)
        }
        if value.range(of: "firm|hard|solid|dense|stiff|metal|wood", options: .regularExpression) != nil {
            return TextureProfile(continuousIntensity: 0, continuousSharpness: 0.62, pulseSpacing: 22, pulseIntensity: 0.82, pulseSharpness: 0.78)
        }
        if value.range(of: "slip|slick|oil|wet", options: .regularExpression) != nil {
            return TextureProfile(continuousIntensity: 0.015, continuousSharpness: 0.45, pulseSpacing: 100, pulseIntensity: 0.03, pulseSharpness: 0.42)
        }
        return TextureProfile(continuousIntensity: 0.11, continuousSharpness: 0.08, pulseSpacing: 34, pulseIntensity: 0.1, pulseSharpness: 0.1)
    }
}

@objc(TextureHapticsPlugin)
class TextureHapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "TextureHapticsPlugin"
    let jsName = "TextureHaptics"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "preview", returnType: CAPPluginReturnPromise)
    ]

    private var engine: CHHapticEngine?
    private var continuousPlayer: CHHapticAdvancedPatternPlayer?
    private var engineRunning = false
    private var profile = TextureProfile.profile(for: "soft")
    private var accumulatedDistance = 0.0

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": CHHapticEngine.capabilitiesForHardware().supportsHaptics])
    }

    @objc func begin(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            do {
                self.profile = self.profile(from: call)
                self.accumulatedDistance = 0
                try self.ensureEngine()
                try self.startContinuousTexture()
                call.resolve()
            } catch {
                call.reject("The texture haptic could not start.", "HAPTIC_START_FAILED", error)
            }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            do {
                self.profile = self.profile(from: call)
                try self.ensureEngine()
                if self.continuousPlayer == nil { try self.startContinuousTexture() }

                let speed = max(0, call.getDouble("speed") ?? 0)
                let distance = max(0, call.getDouble("distance") ?? 0)
                let speedFactor = Float(min(1, max(0, (speed - 12) / 850)))
                let moving = speed > 8
                let continuousIntensity = moving
                    ? self.profile.continuousIntensity * (0.5 + speedFactor * 0.5)
                    : 0
                let parameters = [
                    CHHapticDynamicParameter(parameterID: .hapticIntensityControl, value: continuousIntensity, relativeTime: 0),
                    CHHapticDynamicParameter(parameterID: .hapticSharpnessControl, value: self.profile.continuousSharpness - 0.5, relativeTime: 0)
                ]
                try self.continuousPlayer?.sendParameters(parameters, atTime: CHHapticTimeImmediate)

                self.accumulatedDistance += distance
                let spacing = self.profile.pulseSpacing * Double(1.12 - speedFactor * 0.32)
                if self.accumulatedDistance >= spacing {
                    self.accumulatedDistance -= spacing
                    try self.playTransient(speedFactor: speedFactor)
                    // Don't carry a large backlog into the next frame. A burst of
                    // simultaneous transients reads as vibration instead of grain.
                    self.accumulatedDistance = min(self.accumulatedDistance, spacing)
                }
            } catch {
                print("[TextureHaptics] Update failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            do {
                try self?.continuousPlayer?.stop(atTime: CHHapticTimeImmediate)
                self?.continuousPlayer = nil
                self?.accumulatedDistance = 0
                call.resolve()
            } catch {
                call.reject("The texture haptic could not stop.", "HAPTIC_STOP_FAILED", error)
            }
        }
    }

    @objc func preview(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            do {
                self.profile = self.profile(from: call)
                try self.ensureEngine()
                guard self.profile.pulseIntensity > 0 else {
                    call.resolve()
                    return
                }
                let interval = min(0.18, max(0.055, self.profile.pulseSpacing / 180))
                let events = (0..<5).map { index in
                    CHHapticEvent(
                        eventType: .hapticTransient,
                        parameters: [
                            CHHapticEventParameter(parameterID: .hapticIntensity, value: self.profile.pulseIntensity),
                            CHHapticEventParameter(parameterID: .hapticSharpness, value: self.profile.pulseSharpness)
                        ],
                        relativeTime: Double(index) * interval
                    )
                }
                let pattern = try CHHapticPattern(events: events, parameters: [])
                try self.engine?.makePlayer(with: pattern).start(atTime: CHHapticTimeImmediate)
                call.resolve()
            } catch {
                call.reject("The texture preview could not play.", "HAPTIC_PREVIEW_FAILED", error)
            }
        }
    }

    private func profile(from call: CAPPluginCall) -> TextureProfile {
        let materials = call.getArray("materials", String.self) ?? ["soft"]
        return TextureProfile.mixed(materials.map(TextureProfile.profile(for:)))
    }

    private func ensureEngine() throws {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        if engine == nil {
            let newEngine = try CHHapticEngine()
            newEngine.playsHapticsOnly = true
            newEngine.stoppedHandler = { [weak self] _ in
                self?.continuousPlayer = nil
                self?.engineRunning = false
            }
            newEngine.resetHandler = { [weak self] in
                guard let self else { return }
                do {
                    try self.engine?.start()
                    self.engineRunning = true
                } catch {
                    self.engineRunning = false
                }
            }
            engine = newEngine
        }
        if !engineRunning {
            try engine?.start()
            engineRunning = true
        }
    }

    private func startContinuousTexture() throws {
        try continuousPlayer?.stop(atTime: CHHapticTimeImmediate)
        let event = CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: 1),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.5)
            ],
            relativeTime: 0,
            duration: 1
        )
        let pattern = try CHHapticPattern(events: [event], parameters: [])
        let player = try engine?.makeAdvancedPlayer(with: pattern)
        player?.loopEnabled = true
        continuousPlayer = player
        try player?.start(atTime: CHHapticTimeImmediate)
        try player?.sendParameters([
            CHHapticDynamicParameter(parameterID: .hapticIntensityControl, value: 0, relativeTime: 0)
        ], atTime: CHHapticTimeImmediate)
    }

    private func playTransient(speedFactor: Float) throws {
        guard profile.pulseIntensity > 0 else { return }
        let intensity = profile.pulseIntensity * (0.6 + speedFactor * 0.4)
        let event = CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: profile.pulseSharpness)
            ],
            relativeTime: 0
        )
        let pattern = try CHHapticPattern(events: [event], parameters: [])
        try engine?.makePlayer(with: pattern).start(atTime: CHHapticTimeImmediate)
    }
}
