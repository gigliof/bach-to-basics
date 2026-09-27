// AppKit rendition of the piano-key mark already used by the app's header.
import AppKit

let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
let background = NSBezierPath(roundedRect: NSRect(x: 44, y: 44, width: 936, height: 936), xRadius: 205, yRadius: 205)
NSGradient(starting: NSColor(calibratedRed: 0.49, green: 0.23, blue: 0.93, alpha: 1), ending: NSColor(calibratedRed: 0.29, green: 0.20, blue: 0.77, alpha: 1))!.draw(in: background, angle: -60)
NSColor.white.setFill()
NSBezierPath(roundedRect: NSRect(x: 206, y: 230, width: 612, height: 564), xRadius: 40, yRadius: 40).fill()
let dark = NSColor(calibratedRed: 0.16, green: 0.10, blue: 0.32, alpha: 1)
dark.setFill()
for i in 1..<7 {
    NSBezierPath(rect: NSRect(x: 206 + CGFloat(i) * 612 / 7 - 3, y: 230, width: 6, height: 550)).fill()
}
for i in [1, 2, 4, 5, 6] {
    NSBezierPath(roundedRect: NSRect(x: 206 + CGFloat(i) * 612 / 7 - 27, y: 470, width: 54, height: 324), xRadius: 10, yRadius: 10).fill()
}
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
