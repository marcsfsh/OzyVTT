// Placeholder art for the demo campaign: plain grid battlemaps, tinted atlas maps and lettered token
// discs. Drawn into raw RGBA and encoded as PNG with node:zlib, so the seed needs no image library.
import { crc32, deflateSync } from "node:zlib";

/** A 5x7 bitmap font, enough for labels and token initials. */
const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"]
};

function hex(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

class Raster {
  constructor(width, height, fill = [0, 0, 0, 0]) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 4);
    for (let index = 0; index < width * height; index += 1) this.pixels.set(fill, index * 4);
  }
  set(x, y, rgba) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels.set(rgba, (y * this.width + x) * 4);
  }
  rect(x, y, width, height, rgba) {
    for (let row = Math.max(0, y); row < Math.min(this.height, y + height); row += 1)
      for (let column = Math.max(0, x); column < Math.min(this.width, x + width); column += 1)
        this.pixels.set(rgba, (row * this.width + column) * 4);
  }
  disc(cx, cy, radius, rgba) {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1)
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius ** 2) this.set(x, y, rgba);
  }
  text(value, x, y, scale, rgba) {
    let cursor = x;
    for (const character of value.toUpperCase()) {
      const glyph = GLYPHS[character] ?? GLYPHS[" "];
      glyph.forEach((row, rowIndex) =>
        [...row].forEach((bit, columnIndex) => {
          if (bit === "1") this.rect(cursor + columnIndex * scale, y + rowIndex * scale, scale, scale, rgba);
        })
      );
      cursor += 6 * scale;
    }
  }
  png() {
    const stride = this.width * 4 + 1;
    const raw = Buffer.alloc(stride * this.height);
    for (let row = 0; row < this.height; row += 1)
      this.pixels.copy(raw, row * stride + 1, row * this.width * 4, (row + 1) * this.width * 4);
    const chunk = (type, data) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body));
      return Buffer.concat([length, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0))
    ]);
  }
}

export const CELL_PX = 70;

/** A plain square grid: `columns` x `rows` cells of CELL_PX, a flat floor colour and a title in the corner. */
export function gridMap({ columns, rows, floor, line, title }) {
  const raster = new Raster(columns * CELL_PX, rows * CELL_PX, hex(floor));
  const ink = hex(line);
  for (let column = 0; column <= columns; column += 1) raster.rect(column * CELL_PX - 1, 0, 2, raster.height, ink);
  for (let row = 0; row <= rows; row += 1) raster.rect(0, row * CELL_PX - 1, raster.width, 2, ink);
  raster.rect(6, 6, title.length * 18 + 12, 33, hex(floor));
  raster.text(title, 12, 12, 3, ink);
  return raster.png();
}

/** An atlas map: a flat field with a faint coarse grid and a title, gridless as far as the table is concerned. */
export function atlasMap({ width, height, field, line, title }) {
  const raster = new Raster(width, height, hex(field));
  const ink = hex(line);
  for (let x = 0; x <= width; x += 100) raster.rect(x, 0, 1, height, ink);
  for (let y = 0; y <= height; y += 100) raster.rect(0, y, width, 1, ink);
  raster.text(title, 20, 20, 4, ink);
  return raster.png();
}

/** A round token: a coloured disc with a light ring and up to two initials. */
export function tokenDisc({ color, label }) {
  const size = 140;
  const raster = new Raster(size, size);
  raster.disc(70, 70, 68, hex("#F4F1E8"));
  raster.disc(70, 70, 61, hex(color));
  const initials = label.slice(0, 2).toUpperCase();
  const scale = 7;
  const width = initials.length * 6 * scale - scale;
  raster.text(initials, Math.round(70 - width / 2), Math.round(70 - (7 * scale) / 2), scale, hex("#F4F1E8"));
  return raster.png();
}
