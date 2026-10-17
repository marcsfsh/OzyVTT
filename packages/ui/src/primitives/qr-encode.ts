/**
 * A QR code encoder for the join address, drawn on the GM's own device so the address never leaves the LAN. Byte
 * mode, error correction level M, versions 1 to 10: up to 213 bytes, far more than an `http://host:port` address.
 * The construction follows ISO/IEC 18004; the mask is the one with the lowest penalty score.
 */

export type QrMatrix = readonly (readonly boolean[])[];

const MAX_VERSION = 10;
/** Level M, by version (index 0 unused): error correction codewords per block, and the number of blocks. */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Level M's two format bits. */
const FORMAT_LEVEL_M = 0;

/** Modules left for data and error correction once the function patterns are drawn. */
function rawDataModules(version: number) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    modules -= (25 * align - 10) * align - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

const dataCodewords = (version: number) =>
  Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];

/** Multiplication in GF(2^8) over the QR polynomial x^8 + x^4 + x^3 + x^2 + 1. */
function gfMultiply(x: number, y: number) {
  let z = 0;
  for (let bit = 7; bit >= 0; bit--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> bit) & 1) * x;
  }
  return z & 0xff;
}

function reedSolomonDivisor(degree: number) {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: readonly number[], divisor: readonly number[]) {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, index) => (result[index] ^= gfMultiply(coefficient, factor)));
  }
  return result;
}

/** The data codewords, split into blocks with their error correction, interleaved in reading order. */
function codewords(data: readonly number[], version: number) {
  const blocks = BLOCKS[version];
  const eccLength = ECC_PER_BLOCK[version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = reedSolomonDivisor(eccLength);
  const split: number[][] = [];
  for (let index = 0, offset = 0; index < blocks; index++) {
    const length = shortLength - eccLength + (index < shortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + length);
    offset += length;
    const ecc = reedSolomonRemainder(block, divisor);
    // Short blocks carry a gap so every block lines up for interleaving.
    if (index < shortBlocks) block.push(-1);
    split.push([...block, ...ecc]);
  }
  const result: number[] = [];
  for (let column = 0; column < split[0].length; column++)
    for (const [index, block] of split.entries())
      if (column !== shortLength - eccLength || index >= shortBlocks) result.push(block[column]);
  return result;
}

function alignmentPositions(version: number, size: number) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) result.splice(1, 0, position);
  return result;
}

const MASKS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

/** The penalty score of a finished symbol (ISO/IEC 18004 section 7.8.3); lower reads more reliably. */
function penalty(modules: boolean[][]) {
  const size = modules.length;
  let score = 0;
  const finderLike = (history: number[]) => {
    const n = history[1];
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (
      (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
      (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
    );
  };
  const pushRun = (run: number, history: number[]) => {
    if (history[0] === 0) run += size;
    history.pop();
    history.unshift(run);
  };
  for (const read of [(a: number, b: number) => modules[a][b], (a: number, b: number) => modules[b][a]]) {
    for (let line = 0; line < size; line++) {
      let color = false;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let along = 0; along < size; along++) {
        if (read(line, along) === color) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else {
          pushRun(run, history);
          if (!color) score += finderLike(history) * 40;
          color = read(line, along);
          run = 1;
        }
      }
      if (color) {
        pushRun(run, history);
        run = 0;
      }
      pushRun(run + size, history);
      score += finderLike(history) * 40;
    }
  }
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const color = modules[y][x];
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) score += 3;
    }
  const dark = modules.reduce((total, row) => total + row.filter(Boolean).length, 0);
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/**
 * Encodes `text` as a QR code at error correction level M. Returns the module grid, `true` for dark, without the
 * quiet zone. `mask` picks one of the eight masks; omitted, the lowest-penalty one is used.
 */
export function encodeQr(text: string, mask?: number): QrMatrix {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  const bitsNeeded = (v: number) => 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
  while (version <= MAX_VERSION && bitsNeeded(version) > dataCodewords(version) * 8) version++;
  if (version > MAX_VERSION) throw new RangeError("That text is too long for a QR code here.");

  // Mode, count and data, a terminator, padding to a byte, then the alternating pad bytes.
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let bit = length - 1; bit >= 0; bit--) bits.push((value >>> bit) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) append(byte, 8);
  const capacity = dataCodewords(version) * 8;
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8)
    data.push(bits.slice(index, index + 8).reduce((byte, bit) => (byte << 1) | bit, 0));

  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    fixed[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4]
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
      }
  const aligns = alignmentPositions(version, size);
  for (const [i, ax] of aligns.entries())
    for (const [j, ay] of aligns.entries()) {
      const corner =
        (i === 0 && j === 0) || (i === 0 && j === aligns.length - 1) || (i === aligns.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const drawFormat = (chosen: number) => {
    const value = (FORMAT_LEVEL_M << 3) | chosen;
    let remainder = value;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const format = ((value << 10) | remainder) ^ 0x5412;
    const bit = (i: number) => ((format >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  // Reserved first, so the data skips these modules; the real bits are drawn once the mask is chosen.
  drawFormat(0);
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const value = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const dark = ((value >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  const words = codewords(data, version);
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (fixed[y][x] || index >= words.length * 8) continue;
        modules[y][x] = ((words[index >>> 3] >>> (7 - (index & 7))) & 1) === 1;
        index++;
      }
  }

  const applyMask = (chosen: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[chosen](x, y)) modules[y][x] = !modules[y][x];
  };
  let chosen = mask;
  if (chosen === undefined) {
    let best = Infinity;
    for (let candidate = 0; candidate < 8; candidate++) {
      applyMask(candidate);
      drawFormat(candidate);
      const score = penalty(modules);
      if (score < best) {
        best = score;
        chosen = candidate;
      }
      applyMask(candidate);
    }
  }
  applyMask(chosen!);
  drawFormat(chosen!);
  return modules;
}
