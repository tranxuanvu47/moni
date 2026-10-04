import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buffer) {
  let crc = ~0;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const start = y * (width * 4 + 1);
    raw[start] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(raw, start + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function setPixel(pixels, width, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= width) {
    return;
  }
  const offset = (y * width + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function fill(pixels, width, color) {
  for (let index = 0; index < width * width; index += 1) {
    const offset = index * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3];
  }
}

function strokeSegment(pixels, width, x1, y1, x2, y2, thickness, color) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(length);
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    const cx = x1 + (x2 - x1) * t;
    const cy = y1 + (y2 - y1) * t;
    for (let y = -thickness; y <= thickness; y += 1) {
      for (let x = -thickness; x <= thickness; x += 1) {
        if (x * x + y * y <= thickness * thickness) {
          setPixel(pixels, width, Math.round(cx + x), Math.round(cy + y), color);
        }
      }
    }
  }
}

function drawMark(pixels, width, color, scale = 1) {
  const thickness = Math.round(width * 0.045 * scale);
  const left = width * 0.3;
  const right = width * 0.7;
  const top = width * 0.28;
  const bottom = width * 0.72;
  const valley = width * 0.58;
  const mid = width * 0.5;
  strokeSegment(pixels, width, left, top, left, bottom, thickness, color);
  strokeSegment(pixels, width, right, top, right, bottom, thickness, color);
  strokeSegment(pixels, width, left, top, mid, valley, thickness, color);
  strokeSegment(pixels, width, mid, valley, right, top, thickness, color);
}

const green = [24, 61, 50, 255];
const paper = [248, 249, 246, 255];
const white = [248, 249, 246, 255];
const clear = [0, 0, 0, 0];

function make(width, background, mark) {
  const pixels = new Uint8Array(width * width * 4);
  fill(pixels, width, background);
  if (mark) {
    drawMark(pixels, width, mark);
  }
  return encodePng(width, width, pixels);
}

writeFileSync('assets/images/icon.png', make(1024, green, white));
writeFileSync('assets/images/android-icon-background.png', make(1024, green, null));
writeFileSync('assets/images/android-icon-foreground.png', make(1024, clear, white));
writeFileSync('assets/images/android-icon-monochrome.png', make(1024, clear, white));
writeFileSync('assets/images/splash-icon.png', make(1024, clear, green));
writeFileSync('assets/images/favicon.png', make(196, green, white));
