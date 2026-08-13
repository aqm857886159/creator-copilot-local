import Foundation
import ImageIO
import Vision

struct OcrItem: Encodable {
    let path: String
    let text: String
    let confidence: Float
    let bbox: [String: CGFloat]
}

let paths = Array(CommandLine.arguments.dropFirst())
var items: [OcrItem] = []

for path in paths {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { continue }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
        try handler.perform([request])
    } catch {
        continue
    }
    for observation in request.results ?? [] {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let box = observation.boundingBox
        items.append(OcrItem(path: path, text: candidate.string, confidence: candidate.confidence, bbox: ["x": box.origin.x, "y": box.origin.y, "width": box.size.width, "height": box.size.height]))
    }
}

let data = try JSONEncoder().encode(items)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
