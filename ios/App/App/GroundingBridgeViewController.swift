import UIKit
import Capacitor

/// The single place where app-local native plugins are registered with the
/// Capacitor bridge. Add future iOS-only plugins here as the app grows.
class GroundingBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(NativeVisionSegmentPlugin())
        bridge?.registerPluginInstance(HealthTrendPlugin())
    }
}
