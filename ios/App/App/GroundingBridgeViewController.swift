import UIKit
import Capacitor
import Photos

/// The single place where app-local native plugins are registered with the
/// Capacitor bridge. Add future iOS-only plugins here as the app grows.
class GroundingBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(NativeVisionSegmentPlugin())
        bridge?.registerPluginInstance(HealthTrendPlugin())
        bridge?.registerPluginInstance(WatchSignalPlugin())
        bridge?.registerPluginInstance(PhotoExporterPlugin())
    }
}

private struct PhotoExportOptions: Decodable {
    let dataUrl: String
    let fileName: String
}

@objc(PhotoExporterPlugin)
class PhotoExporterPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "PhotoExporterPlugin"
    let jsName = "PhotoExporter"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveImage", returnType: CAPPluginReturnPromise)
    ]

    @objc func saveImage(_ call: CAPPluginCall) {
        let options: PhotoExportOptions
        do {
            options = try call.decode(PhotoExportOptions.self)
        } catch {
            call.reject("Invalid image export request.", nil, error)
            return
        }

        guard let separator = options.dataUrl.firstIndex(of: ","),
              let data = Data(base64Encoded: String(options.dataUrl[options.dataUrl.index(after: separator)...])),
              UIImage(data: data) != nil else {
            call.reject("The journal image could not be read.")
            return
        }

        let save = {
            PHPhotoLibrary.shared().performChanges({
                let request = PHAssetCreationRequest.forAsset()
                let resource = PHAssetResourceCreationOptions()
                resource.originalFilename = options.fileName
                request.addResource(with: .photo, data: data, options: resource)
            }) { success, error in
                DispatchQueue.main.async {
                    if success {
                        call.resolve(["saved": true])
                    } else {
                        call.reject(error?.localizedDescription ?? "The image could not be saved to Photos.", "PHOTO_SAVE_FAILED", error)
                    }
                }
            }
        }

        if #available(iOS 14.0, *) {
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                guard status == .authorized || status == .limited else {
                    DispatchQueue.main.async { call.reject("Photo access was not allowed.", "PHOTO_PERMISSION_DENIED") }
                    return
                }
                save()
            }
        } else {
            PHPhotoLibrary.requestAuthorization { status in
                guard status == .authorized else {
                    DispatchQueue.main.async { call.reject("Photo access was not allowed.", "PHOTO_PERMISSION_DENIED") }
                    return
                }
                save()
            }
        }
    }
}
