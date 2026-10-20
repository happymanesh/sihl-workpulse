/**
 * Real pixel dimensions of a JPEG or PNG, read from the file header.
 *
 * The guides used to assume every screen was 799x544 and size the border
 * around it from that. Captures drifted - 800x537, 800x538, 584x398 - and each
 * one left a thin strip of empty frame under the picture, because pdfkit
 * preserves the image's own ratio while the border had been drawn to a
 * different one. Measuring is cheaper than remembering to re-crop.
 */
const fs = require("fs");

function imageSize(file) {
  const b = fs.readFileSync(file);

  // PNG: width and height are at fixed offsets in the IHDR chunk.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }

  // JPEG: walk the segments to the start-of-frame marker.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }

  throw new Error(`Could not read the dimensions of ${file}`);
}

/** How tall the image will actually be drawn when fitted to `width`. */
function frameHeight(file, width) {
  const { width: w, height: h } = imageSize(file);
  return (width * h) / w;
}

module.exports = { imageSize, frameHeight };
