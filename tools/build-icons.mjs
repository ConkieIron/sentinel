#!/usr/bin/env node
// Renders the SENTINEL mark (publisher/static/public/favicon.svg) to the PNG and ICO icons that
// browsers without SVG favicon support, iOS home screens and search engines ask for. Drawn from
// the same 32-unit geometry with signed distances, so it needs no image libraries.
//
//   node tools/build-icons.mjs

import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const OUT = new URL('../publisher/static/public/', import.meta.url).pathname;
const NAVY = [0x0b, 0x25, 0x45];
const WHITE = [0xff, 0xff, 0xff];
const BLUE = [0x4f, 0x8f, 0xe6];

const box = (x, y, x0, y0, x1, y1, r = 0) => {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const qx = Math.abs(x - cx) - (x1 - x0) / 2 + r;
  const qy = Math.abs(y - cy) - (y1 - y0) / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
/**
 * Distances (in mark units) to the tile, the white ring and crosshair, and the blue centre.
 * `half` is half the stroke width: 1 matches the SVG; tab-sized icons use heavier strokes so the
 * ring stays crisp at 16px.
 */
function shapes(x, y, corner, half, dotR) {
  const tile = box(x, y, 0, 0, 32, 32, corner);
  let white = Math.abs(Math.hypot(x - 16, y - 16) - 9) - half;
  for (const [a, b] of [[3, 9], [23, 29]]) {
    white = Math.min(white, box(x, y, 16 - half, a, 16 + half, b), box(x, y, a, 16 - half, b, 16 + half));
  }
  const dot = Math.hypot(x - 16, y - 16) - dotR;
  return { tile, white, dot };
}

/**
 * RGBA pixels at `size`. `inset` shrinks the mark inside a full-bleed tile (for iOS and maskable
 * icons, which the platform crops); `corner` is the tile's corner radius in mark units.
 */
function render(size, { inset = 0, corner = 4 } = {}) {
  const small = size <= 32;
  const half = small ? 1.5 : 1;
  const dotR = small ? 4 : 3.5;
  const px = new Uint8Array(size * size * 4);
  const markSize = size * (1 - 2 * inset);
  const unit = 32 / markSize;
  const cover = (d) => Math.min(1, Math.max(0, 0.5 - d / unit));
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5 - size * inset) * unit;
      const y = (j + 0.5 - size * inset) * unit;
      const s = shapes(x, y, corner, half, dotR);
      const tile = inset ? 1 : cover(s.tile);
      const w = cover(s.white);
      const b = cover(s.dot);
      const o = (j * size + i) * 4;
      for (let c = 0; c < 3; c++) {
        const v = NAVY[c] * (1 - w) + WHITE[c] * w;
        px[o + c] = Math.round(v * (1 - b) + BLUE[c] * b);
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
  'icon-maskable-512.png': png(512, render(512, { inset: 0.14 })),
  'apple-touch-icon.png': png(180, render(180, { inset: 0.1 })),
};
for (const [name, data] of Object.entries(files)) {
  await writeFile(join(OUT, name), data);
  console.log(`${name}  ${data.length} bytes`);
}
