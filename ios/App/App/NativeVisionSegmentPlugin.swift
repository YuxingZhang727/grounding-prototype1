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
        case .noObservation: return "Apple Vision could not find a distinct object in this photo. Try tapping nearer its center or drag a frame around it."
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
            return try makeSaliencyCutout(
                image: CIImage(cgImage: cgImage),
                imageData: options.image,
                points: options.points,
                handler: handler
            )
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

    /// Foreground-instance masks power the Photos-style subject lift, so they can
    /// legitimately return no result for a cluttered scene. Objectness saliency
    /// is a lighter-weight Vision fallback that still finds likely object regions.
    @available(iOS 17.0, *)
    private static func makeSaliencyCutout(
        image: CIImage,
        imageData: String,
        points: [NativeSegmentPoint],
        handler: VNImageRequestHandler
    ) throws -> JSObject {
        let request = VNGenerateObjectnessBasedSaliencyImageRequest()
        try handler.perform([request])
        guard let observation = request.results?.first else {
            throw NativeSegmentError.noObservation
        }

        let tapPoints = points.map {
            CGPoint(x: min(1, max(0, $0.x / 100)), y: min(1, max(0, 1 - $0.y / 100)))
        }
        let objects = observation.salientObjects ?? []
        guard !objects.isEmpty, !tapPoints.isEmpty else {
            throw NativeSegmentError.noObservation
        }

        var selectedRects: [CGRect] = []
        for tap in tapPoints {
            let containing = objects
                .filter { $0.boundingBox.insetBy(dx: -0.035, dy: -0.035).contains(tap) }
                .min { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }
            let closest = containing ?? objects.min {
                distance(from: tap, to: $0.boundingBox) < distance(from: tap, to: $1.boundingBox)
            }
            if let closest { selectedRects.append(closest.boundingBox) }
        }
        guard var normalizedCrop = selectedRects.first else {
            throw NativeSegmentError.noObservation
        }
        for rect in selectedRects.dropFirst() { normalizedCrop = normalizedCrop.union(rect) }
        normalizedCrop = normalizedCrop.insetBy(dx: -0.035, dy: -0.035)
            .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))

        let heatmap = CIImage(cvPixelBuffer: observation.pixelBuffer)
        let scaledMask = heatmap.transformed(by: CGAffineTransform(
            scaleX: image.extent.width / heatmap.extent.width,
            y: image.extent.height / heatmap.extent.height
        ))
        let transparent = CIImage(color: .clear).cropped(to: image.extent)
        let masked = image.applyingFilter("CIBlendWithMask", parameters: [
            kCIInputBackgroundImageKey: transparent,
            kCIInputMaskImageKey: scaledMask
        ])
        let crop = CGRect(
            x: normalizedCrop.minX * image.extent.width,
            y: normalizedCrop.minY * image.extent.height,
            width: normalizedCrop.width * image.extent.width,
            height: normalizedCrop.height * image.extent.height
        ).integral.intersection(image.extent)

        let context = CIContext(options: [.cacheIntermediates: false])
        guard !crop.isEmpty,
              let outputCGImage = context.createCGImage(masked, from: crop),
              let png = UIImage(cgImage: outputCGImage).pngData() else {
            throw NativeSegmentError.outputFailed
        }
        return [
            "cutoutUrl": "data:image/png;base64,\(png.base64EncodedString())",
            "overlayUrl": imageData,
            "aspectRatio": Double(outputCGImage.width) / Double(max(1, outputCGImage.height)),
            "score": 0,
            "method": "saliency"
        ]
    }

    private static func distance(from point: CGPoint, to rect: CGRect) -> CGFloat {
        let dx = max(rect.minX - point.x, point.x - rect.maxX, 0)
        let dy = max(rect.minY - point.y, point.y - rect.maxY, 0)
        return hypot(dx, dy)
    }
}
