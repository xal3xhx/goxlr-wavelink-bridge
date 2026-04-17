import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, "..", "icons");

/**
 * Generate a minimal 16x16 .ico file with a solid colored circle.
 * Returns the file path.
 */
function generateIco(filename, r, g, b) {
  const path = join(ICONS_DIR, filename);
  if (existsSync(path)) return path;

  const W = 16, H = 16;
  const pixelCount = W * H;
  const pixelDataSize = pixelCount * 4;
  const andMaskRowSize = Math.ceil(W / 8);
  const andMaskPadded = Math.ceil(andMaskRowSize / 4) * 4;
  const andMaskSize = andMaskPadded * H;
  const bmpSize = 40 + pixelDataSize + andMaskSize;

  const buf = Buffer.alloc(6 + 16 + bmpSize);
  let off = 0;

  // ICONDIR
  buf.writeUInt16LE(0, off); off += 2;     // reserved
  buf.writeUInt16LE(1, off); off += 2;     // type (1 = icon)
  buf.writeUInt16LE(1, off); off += 2;     // count

  // ICONDIRENTRY
  buf.writeUInt8(W, off); off += 1;        // width
  buf.writeUInt8(H, off); off += 1;        // height
  buf.writeUInt8(0, off); off += 1;        // color count
  buf.writeUInt8(0, off); off += 1;        // reserved
  buf.writeUInt16LE(1, off); off += 2;     // planes
  buf.writeUInt16LE(32, off); off += 2;    // bit count
  buf.writeUInt32LE(bmpSize, off); off += 4; // size of data
  buf.writeUInt32LE(22, off); off += 4;    // offset to data

  // BITMAPINFOHEADER
  buf.writeUInt32LE(40, off); off += 4;    // header size
  buf.writeInt32LE(W, off); off += 4;      // width
  buf.writeInt32LE(H * 2, off); off += 4;  // height (double for ICO)
  buf.writeUInt16LE(1, off); off += 2;     // planes
  buf.writeUInt16LE(32, off); off += 2;    // bit count
  buf.writeUInt32LE(0, off); off += 4;     // compression
  buf.writeUInt32LE(pixelDataSize + andMaskSize, off); off += 4;
  buf.writeInt32LE(0, off); off += 4;      // x ppm
  buf.writeInt32LE(0, off); off += 4;      // y ppm
  buf.writeUInt32LE(0, off); off += 4;     // colors used
  buf.writeUInt32LE(0, off); off += 4;     // important colors

  // Pixel data (BGRA, bottom-up)
  const cx = W / 2, cy = H / 2, radius = 6;
  for (let y = H - 1; y >= 0; y--) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        buf.writeUInt8(b, off); off += 1;  // B
        buf.writeUInt8(g, off); off += 1;  // G
        buf.writeUInt8(r, off); off += 1;  // R
        buf.writeUInt8(255, off); off += 1; // A
      } else {
        off += 4; // transparent (zeros)
      }
    }
  }

  // AND mask (all zeros = all visible, transparency handled by alpha)
  // Already zeros from Buffer.alloc

  if (!existsSync(ICONS_DIR)) mkdirSync(ICONS_DIR, { recursive: true });
  writeFileSync(path, buf);
  return path;
}

export function ensureIcons() {
  return {
    connected: generateIco("icon-connected.ico", 76, 175, 80),     // green
    partial: generateIco("icon-partial.ico", 255, 193, 7),          // yellow/amber
    disconnected: generateIco("icon-disconnected.ico", 244, 67, 54), // red
  };
}
