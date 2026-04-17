import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const W = 256, H = 256;

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const stride = 1 + W * 4;
const raw = Buffer.alloc(H * stride);
for (let y = 0; y < H; y++) {
  raw[y * stride] = 0;
  for (let x = 0; x < W; x++) {
    const i = y * stride + 1 + x * 4;
    const dx = x - 128, dy = y - 128;
    const d = Math.sqrt(dx * dx + dy * dy);
    const inCircle = d < 120;
    if (inCircle) {
      const t = d / 120;
      raw[i] = Math.round(99 - 20 * t);
      raw[i + 1] = Math.round(102 - 32 * t);
      raw[i + 2] = Math.round(241 - 12 * t);
      raw[i + 3] = 255;
    } else {
      raw[i] = 0; raw[i + 1] = 0; raw[i + 2] = 0; raw[i + 3] = 0;
    }
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

const icoHeader = Buffer.from([0, 0, 1, 0, 1, 0]);
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0; entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);

const out = Buffer.concat([icoHeader, entry, png]);
writeFileSync(new URL("./icon.ico", import.meta.url), out);
writeFileSync(new URL("./icon.png", import.meta.url), png);
console.log("wrote build/icon.ico + build/icon.png", out.length, "bytes");
