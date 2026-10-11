import Foundation
import Vision
import ImageIO

// Local Apple Vision OCR only. Never uploads bytes or infers emotions/faces.
do {
    guard CommandLine.arguments.count == 2 else { throw NSError(domain: "OCR", code: 1) }
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0, height > 0, Double(width) * Double(height) <= 100_000_000 else {
        throw NSError(domain: "OCR", code: 2)
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    request.usesLanguageCorrection = true
    // Decode one frame through ImageIO and bound peak OCR memory. This also
    // handles container formats Vision's URL handler may reject directly.
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 4096
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
        throw NSError(domain: "OCR", code: 3)
    }
    if image.width >= 32 && image.height >= 32 {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    }
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first }
    // Low-confidence text is withheld instead of becoming relationship evidence.
    let accepted = lines.filter { $0.confidence >= 0.5 }.prefix(150)
    let text = String(accepted.map { $0.string }.joined(separator: "\n").prefix(10000))
    let confidence = accepted.isEmpty ? 0 : accepted.reduce(0.0) { $0 + Double($1.confidence) } / Double(accepted.count)
    let data = try JSONSerialization.data(withJSONObject: ["text": text, "confidence": confidence])
    FileHandle.standardOutput.write(data)
} catch {
    // No source paths or OCR text in error output.
    FileHandle.standardError.write(Data("Local OCR unavailable (code \((error as NSError).code))\n".utf8))
    exit(1)
}
