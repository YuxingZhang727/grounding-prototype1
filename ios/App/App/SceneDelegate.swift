import UIKit
import Capacitor
import CoreImage
import Vision

private struct NativeSegmentPoint: Decodable {
    let x: Double
    let y: Double
}

private struct NativeSegmentOptions: Decodable {
    let image: String
    let points: [NativeSegmentPoint]
}

private enum NativeSegmentError: LocalizedError {
    case invalidImage
    case noObservation
    case noObject
    case outputFailed

    var errorDescription: String? {
        switch self {
        case .invalidImage: return "The selected photo could not be read."
        case .noObservation: return "Apple Vision could not analyze this photo."
        case .noObject: return "No foreground object was found at that point."
        case .outputFailed: return "The native cutout could not be rendered."
        }
    }
}

@objc(NativeVisionSegmentPlugin)
class NativeVisionSegmentPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "NativeVisionSegmentPlugin"
    let jsName = "NativeVisionSegment"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "segment", returnType: CAPPluginReturnPromise)
    ]

    @objc func segment(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else {
            call.unavailable("Native object segmentation requires iOS 17 or newer.")
            return
        }

        let options: NativeSegmentOptions
        do {
            options = try call.decode(NativeSegmentOptions.self)
        } catch {
            call.reject("Invalid native segmentation request.", nil, error)
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let result = try autoreleasepool {
                    try Self.makeCutout(options: options)
                }
                DispatchQueue.main.async { call.resolve(result) }
            } catch {
                DispatchQueue.main.async {
                    call.reject(error.localizedDescription, "NATIVE_SEGMENT_FAILED", error)
                }
            }
        }
    }

    @available(iOS 17.0, *)
    private static func makeCutout(options: NativeSegmentOptions) throws -> JSObject {
        guard let separator = options.image.firstIndex(of: ","),
              let imageData = Data(base64Encoded: String(options.image[options.image.index(after: separator)...])),
              let image = UIImage(data: imageData),
              let cgImage = image.cgImage else {
            throw NativeSegmentError.invalidImage
        }

        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
        try handler.perform([request])
        guard let observation = request.results?.first else {
            throw NativeSegmentError.noObservation
        }

        let mask = observation.instanceMask
        let maskWidth = CVPixelBufferGetWidth(mask)
        let maskHeight = CVPixelBufferGetHeight(mask)
        CVPixelBufferLockBaseAddress(mask, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(mask) else {
            throw NativeSegmentError.noObservation
        }

        let bytesPerRow = CVPixelBufferGetBytesPerRow(mask)
        var selectedInstances = IndexSet()
        for point in options.points {
            let normalized = CGPoint(
                x: min(1, max(0, point.x / 100)),
                y: min(1, max(0, 1 - point.y / 100))
            )
            let pixel = VNImagePointForNormalizedPoint(normalized, maskWidth - 1, maskHeight - 1)
            let offset = Int(pixel.y) * bytesPerRow + Int(pixel.x)
            let label = baseAddress.load(fromByteOffset: offset, as: UInt8.self)
            if label > 0 { selectedInstances.insert(Int(label)) }
        }
        guard !selectedInstances.isEmpty else {
            throw NativeSegmentError.noObject
        }

        let outputBuffer = try observation.generateMaskedImage(
            ofInstances: selectedInstances,
            from: handler,
            croppedToInstancesExtent: true
        )
        let outputImage = CIImage(cvPixelBuffer: outputBuffer)
        let context = CIContext(options: [.cacheIntermediates: false])
        guard let outputCGImage = context.createCGImage(outputImage, from: outputImage.extent),
              let png = UIImage(cgImage: outputCGImage).pngData() else {
            throw NativeSegmentError.outputFailed
        }

        return [
            "cutoutUrl": "data:image/png;base64,\(png.base64EncodedString())",
            "overlayUrl": options.image,
            "aspectRatio": Double(outputCGImage.width) / Double(max(1, outputCGImage.height)),
            "score": 0
        ]
    }
}

class GroundingBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(NativeVisionSegmentPlugin())
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = GroundingBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
