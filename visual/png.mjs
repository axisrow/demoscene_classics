import { deflateSync, inflateSync } from 'node:zlib';
import { CRC32 } from './crc32.mjs';

// Minimal, dependency-free PNG support for the visual harness.
//
// The visual suite must not pull in image libraries: it encodes its own
// review/contact-sheet PNGs and decodes capture + baseline PNGs for pixel
// comparison. Only the PNG subset the harness actually produces is supported
// (8-bit RGBA, single IDAT, no interlace). Decoding additionally tolerates the
// multiple-IDAT and 8-bit-RGB forms Chromium emits via toDataURL.

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC32(crcInput) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

// Encode 8-bit RGBA pixels to a PNG Buffer.
export function encodePng({ width, height, rgba }) {
  if (rgba.length !== width * height * 4) {
    throw new RangeError('encodePng: rgba buffer does not match width*height*4.');
  }
  // Prepend a filter-type byte (0 = None) to each scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Reverse the per-scanline PNG filter. `bpp` = bytes per pixel.
function unfilter(raw, width, height, bpp, stride) {
  const out = Buffer.alloc(stride * height);
  let inOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inOffset++];
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[inOffset++];
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[prevRowStart + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prevRowStart + x - bpp] : 0;
      let recon;
      switch (filter) {
        case 0: recon = cur; break;
        case 1: recon = (cur + left) & 0xff; break;
        case 2: recon = (cur + up) & 0xff; break;
        case 3: recon = (cur + ((left + up) >> 1)) & 0xff; break;
        case 4: recon = (cur + paeth(left, up, upLeft)) & 0xff; break;
        default: throw new RangeError(`Unsupported PNG filter type ${filter}.`);
      }
      out[rowStart + x] = recon;
    }
  }
  return out;
}

// Decode a PNG Buffer to { width, height, rgba } (8-bit RGBA, alpha forced to 255
// for RGB sources). Supports the 8-bit RGB/RGBA, single or multi-IDAT forms.
export function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new RangeError('decodePng: not a PNG (bad signature).');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8) {
    throw new RangeError(`decodePng: unsupported bit depth ${bitDepth} (only 8-bit).`);
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) {
    throw new RangeError(`decodePng: unsupported colour type ${colorType} (only RGB/RGBA).`);
  }
  const bpp = channels;
  const stride = width * channels;
  const compressed = Buffer.concat(idatChunks);
  const raw = inflateSync(compressed);
  const unfiltered = unfilter(raw, width, height, bpp, stride);
  if (channels === 4) {
    return { width, height, rgba: unfiltered };
  }
  // Expand RGB to RGBA.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < unfiltered.length; i += 3, j += 4) {
    rgba[j] = unfiltered[i];
    rgba[j + 1] = unfiltered[i + 1];
    rgba[j + 2] = unfiltered[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}
