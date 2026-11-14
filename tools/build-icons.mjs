#!/usr/bin/env node
// Renders the SENTINEL logo (publisher/static/public/favicon.svg: an eye with a globe for its
// iris on a navy tile) to the PNG and ICO icons that browsers without SVG favicon support, iOS
// home screens and search engines ask for. Drawn from the same 240-unit geometry as the SVG with
// signed distances, so it needs no image libraries.
//
//   node tools/build-icons.mjs

import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const OUT = new URL('../publisher/static/public/', import.meta.url).pathname;
const NAVY = [0x1c, 0x27, 0x53];
const WHITE = [0xff, 0xff, 0xff];
const BLUE = [0x00, 0x78, 0xff];

// Geometry, in the SVG's units (viewBox 0 0 240 240).
const C = 119.5;
const TILE_R = 42;
const EYE = { left: 20, right: 219, rise: 46.5 };
const EYE_R = ((EYE.right - EYE.left) ** 2 / 4 + EYE.rise ** 2) / (2 * EYE.rise);
const GLOBE_R = 44.25;
const MERIDIAN_RX = 17.5;

const box = (x, y, x0, y0, x1, y1, r = 0) => {
  const qx = Math.abs(x - (x0 + x1) / 2) - (x1 - x0) / 2 + r;
  const qy = Math.abs(y - (y0 + y1) / 2) - (y1 - y0) / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

/** Distance to one arc of the eye: the circle through both corners, bulging up (-1) or down (+1). */
function eyeArc(x, y, dir) {
  const cy = C - dir * (EYE_R - EYE.rise);
  const a = Math.atan2(y - cy, x - C);
  const aL = Math.atan2(C - cy, EYE.left - C);
  const aR = Math.atan2(C - cy, EYE.right - C);
  const onArc = dir < 0 ? a >= aL && a <= aR : a <= aL && a >= aR;
  if (onArc) return Math.abs(Math.hypot(x - C, y - cy) - EYE_R);
  return Math.min(Math.hypot(x - EYE.left, y - C), Math.hypot(x - EYE.right, y - C));
}

/** Approximate distance to an ellipse outline (good enough for anti-aliasing). */
function ellipse(x, y, rx, ry) {
  const px = x - C;
  const py = y - C;
  const k0 = Math.hypot(px / rx, py / ry);
  const k1 = Math.hypot(px / (rx * rx), py / (ry * ry));
  return k1 ? Math.abs((k0 * (k0 - 1)) / k1) : Math.min(rx, ry);
}

/**
 * RGBA pixels at `size`. `scale` shrinks the logo inside the square and `bleed` fills the whole
 * square with navy (iOS and Android crop icons themselves). Tab-sized icons get heavier strokes
 * so the eye and globe stay legible at 16px.
 */
function render(size, { scale = 1, bleed = false } = {}) {
  const heavy = size <= 32 ? 1.7 : size <= 48 ? 1.3 : 1;
  const half = { eye: 5 * heavy, ring: 4.75 * heavy, line: 4.5 * heavy, meridian: 4 * heavy };
  const unit = 240 / (size * scale);
  const cover = (d) => Math.min(1, Math.max(0, 0.5 - d / unit));
  const px = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = C + ((i + 0.5) / size - 0.5) * 240 / scale;
      const y = C + ((j + 0.5) / size - 0.5) * 240 / scale;
      const r = Math.hypot(x - C, y - C);
      const tile = bleed ? 1 : cover(box(x, y, 0, 0, 240, 240, TILE_R));
      const eye = cover(Math.min(eyeArc(x, y, -1), eyeArc(x, y, 1)) - half.eye);
      const disc = cover(r - GLOBE_R - half.ring);
      const inside = r < GLOBE_R;
      const blue = Math.max(
        cover(Math.abs(r - GLOBE_R) - half.ring),
        inside ? cover(Math.abs(y - C) - half.line) : 0,
        inside ? cover(ellipse(x, y, MERIDIAN_RX * (heavy > 1 ? 1.15 : 1), GLOBE_R) - half.meridian) : 0,
      );
      const o = (j * size + i) * 4;
      for (let c = 0; c < 3; c++) {
        let v = NAVY[c] * (1 - eye) + WHITE[c] * eye;
        v = v * (1 - disc) + NAVY[c] * disc;
        px[o + c] = Math.round(v * (1 - blue) + BLUE[c] * blue);
      }
      px[o + 3] = Math.round(tile * 255);
    }
  }
  return px;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) raw.set(pixels.subarray(j * size * 4, (j + 1) * size * 4), j * (size * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** An ICO holding PNG images, which every current browser reads. */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, n) => {
    const e = 6 + 16 * n;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.data)]);
}

const files = {
  'favicon.ico': ico([16, 32, 48].map((size) => ({ size, data: png(size, render(size)) }))),
  'favicon-32.png': png(32, render(32)),
  'icon-192.png': png(192, render(192)),
  'icon-512.png': png(512, render(512)),
  'icon-maskable-512.png': png(512, render(512, { bleed: true, scale: 0.74 })),
  'apple-touch-icon.png': png(180, render(180, { bleed: true, scale: 0.9 })),
};
for (const [name, data] of Object.entries(files)) {
  await writeFile(join(OUT, name), data);
  console.log(`${name}  ${data.length} bytes`);
}
