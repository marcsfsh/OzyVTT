import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type MapImageFormat = "png" | "jpeg" | "webp" | "gif" | "bmp";
export type MapImageInspection = Readonly<{
  format: MapImageFormat;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/bmp";
  extension: "png" | "jpg" | "webp" | "gif" | "bmp";
  width: number;
  height: number;
  byteLength: number;
  animated: boolean;
}>;

export type MapImagePolicy = Readonly<{
  maxBytes?: number;
  maxDimensionPx?: number;
  maxPixels?: number;
  allowAnimation?: boolean;
}>;

export type MapAssetMetadata = Readonly<{
  schemaVersion: 1;
  id: string;
  checksumSha256: string;
  originalName: string;
  format: MapImageFormat;
  mediaType: MapImageInspection["mediaType"];
  extension: MapImageInspection["extension"];
  width: number;
  height: number;
  byteLength: number;
  animated: boolean;
  importedAt: string;
}>;

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_DIMENSION = 32_768;
const DEFAULT_MAX_PIXELS = 100_000_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function matches(buffer: Buffer, expected: Buffer, offset = 0) { return buffer.length >= offset + expected.length && buffer.subarray(offset, offset + expected.length).equals(expected); }
function ascii(buffer: Buffer, start: number, end: number) { return buffer.subarray(start, end).toString("ascii"); }

function inspectPng(buffer: Buffer): MapImageInspection | null {
  if (!matches(buffer, PNG_SIGNATURE)) return null;
  if (buffer.length < 24 || ascii(buffer, 12, 16) !== "IHDR") throw new Error("PNG is missing a valid IHDR header.");
  return { format: "png", mediaType: "image/png", extension: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), byteLength: buffer.length, animated: buffer.indexOf(Buffer.from("acTL", "ascii"), 24) !== -1 };
}

function inspectJpeg(buffer: Buffer): MapImageInspection | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < buffer.length) {
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw new Error("JPEG contains a malformed segment length.");
    if (JPEG_SOF.has(marker)) {
      if (length < 7) throw new Error("JPEG frame header is incomplete.");
      return { format: "jpeg", mediaType: "image/jpeg", extension: "jpg", width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3), byteLength: buffer.length, animated: false };
    }
    offset += length;
  }
  throw new Error("JPEG dimensions could not be read from a supported frame header.");
}

function uint24le(buffer: Buffer, offset: number) { return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16); }
function inspectWebp(buffer: Buffer): MapImageInspection | null {
  if (buffer.length < 30 || ascii(buffer, 0, 4) !== "RIFF" || ascii(buffer, 8, 12) !== "WEBP") return null;
  const chunk = ascii(buffer, 12, 16);
  if (chunk === "VP8X") return { format: "webp", mediaType: "image/webp", extension: "webp", width: uint24le(buffer, 24) + 1, height: uint24le(buffer, 27) + 1, byteLength: buffer.length, animated: (buffer[20] & 0x02) !== 0 };
  if (chunk === "VP8L") {
    if (buffer[20] !== 0x2f || buffer.length < 25) throw new Error("WebP lossless header is malformed.");
    const width = 1 + buffer[21] + ((buffer[22] & 0x3f) << 8);
    const height = 1 + ((buffer[22] & 0xc0) >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10);
    return { format: "webp", mediaType: "image/webp", extension: "webp", width, height, byteLength: buffer.length, animated: false };
  }
  if (chunk === "VP8 ") {
    if (buffer.length < 30 || buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) throw new Error("WebP lossy frame header is malformed.");
    return { format: "webp", mediaType: "image/webp", extension: "webp", width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, byteLength: buffer.length, animated: false };
  }
  throw new Error("WebP uses an unsupported frame header.");
}

function inspectGif(buffer: Buffer): MapImageInspection | null {
  const header = ascii(buffer, 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  if (buffer.length < 10) throw new Error("GIF logical screen descriptor is incomplete.");
  let frames = 0;
  for (let index = 10; index < buffer.length && frames < 2; index++) if (buffer[index] === 0x2c) frames++;
  return { format: "gif", mediaType: "image/gif", extension: "gif", width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), byteLength: buffer.length, animated: frames > 1 };
}

function inspectBmp(buffer: Buffer): MapImageInspection | null {
  if (buffer.length < 26 || ascii(buffer, 0, 2) !== "BM") return null;
  const dibSize = buffer.readUInt32LE(14);
  if (dibSize === 12) return { format: "bmp", mediaType: "image/bmp", extension: "bmp", width: buffer.readUInt16LE(18), height: buffer.readUInt16LE(20), byteLength: buffer.length, animated: false };
  if (dibSize < 40 || buffer.length < 26) throw new Error("BMP uses an unsupported information header.");
  return { format: "bmp", mediaType: "image/bmp", extension: "bmp", width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)), byteLength: buffer.length, animated: false };
}

export function inspectMapImage(input: Uint8Array, policy: MapImagePolicy = {}): MapImageInspection {
  const buffer = Buffer.from(input);
  const maxBytes = policy.maxBytes ?? DEFAULT_MAX_BYTES;
  if (buffer.length === 0) throw new Error("Map image is empty.");
  if (buffer.length > maxBytes) throw new Error(`Map image exceeds the ${maxBytes} byte upload limit.`);
  const inspection = inspectPng(buffer) ?? inspectJpeg(buffer) ?? inspectWebp(buffer) ?? inspectGif(buffer) ?? inspectBmp(buffer);
  if (!inspection) throw new Error("Unsupported map image. Use a valid PNG, JPEG, WebP, GIF, or BMP; additional normalized formats are planned.");
  if (!Number.isInteger(inspection.width) || !Number.isInteger(inspection.height) || inspection.width < 1 || inspection.height < 1) throw new Error("Map image dimensions are invalid.");
  const maxDimension = policy.maxDimensionPx ?? DEFAULT_MAX_DIMENSION;
  if (inspection.width > maxDimension || inspection.height > maxDimension) throw new Error(`Map image dimensions exceed the ${maxDimension} pixel limit.`);
  const maxPixels = policy.maxPixels ?? DEFAULT_MAX_PIXELS;
  if (inspection.width * inspection.height > maxPixels) throw new Error(`Map image exceeds the ${maxPixels} pixel safety limit.`);
  if (inspection.animated && !policy.allowAnimation) throw new Error("Animated maps require an explicit frame-selection or flattening step.");
  return inspection;
}

function deterministicAssetId(checksum: string) {
  const bytes = Buffer.from(checksum.slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeOriginalName(name: string) {
  const leaf = name.replace(/\\/g, "/").split("/").pop() ?? "map";
  const sanitized = leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return !sanitized || sanitized === "." || sanitized === ".." ? "map" : sanitized;
}

function validateMetadata(value: unknown): MapAssetMetadata {
  if (!value || typeof value !== "object") throw new Error("Map asset metadata is malformed.");
  const metadata = value as Partial<MapAssetMetadata>;
  const formats = { png: ["image/png", "png"], jpeg: ["image/jpeg", "jpg"], webp: ["image/webp", "webp"], gif: ["image/gif", "gif"], bmp: ["image/bmp", "bmp"] } as const;
  const format = typeof metadata.format === "string" && metadata.format in formats
    ? formats[metadata.format as keyof typeof formats]
    : undefined;
  const width = metadata.width;
  const height = metadata.height;
  const byteLength = metadata.byteLength;
  if (metadata.schemaVersion !== 1 || typeof metadata.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(metadata.id) || typeof metadata.checksumSha256 !== "string" || !/^[0-9a-f]{64}$/.test(metadata.checksumSha256) || typeof metadata.originalName !== "string" || metadata.originalName.length < 1 || metadata.originalName.length > 200 || !format || metadata.mediaType !== format[0] || metadata.extension !== format[1] || !Number.isInteger(width) || width === undefined || width < 1 || !Number.isInteger(height) || height === undefined || height < 1 || !Number.isInteger(byteLength) || byteLength === undefined || byteLength < 1 || typeof metadata.animated !== "boolean" || typeof metadata.importedAt !== "string" || !Number.isFinite(Date.parse(metadata.importedAt))) throw new Error("Map asset metadata is malformed.");
  return metadata as MapAssetMetadata;
}

export class MapAssetStore {
  private operationQueue: Promise<void> = Promise.resolve();
  constructor(private readonly rootDirectory: string, private readonly policy: MapImagePolicy = {}, private readonly now: () => number = Date.now) {}

  async initialize() { await Promise.all([mkdir(this.originalDirectory, { recursive: true }), mkdir(this.metadataDirectory, { recursive: true }), mkdir(this.temporaryDirectory, { recursive: true })]); }

  async import(input: Uint8Array, originalName: string) {
    const operation = async () => {
      const inspection = inspectMapImage(input, this.policy);
      const buffer = Buffer.from(input);
      const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
      const id = deterministicAssetId(checksumSha256);
      const existing = await this.get(id);
      if (existing) {
        if (existing.checksumSha256 !== checksumSha256) throw new Error("Map asset identifier collision detected.");
        return { metadata: existing, duplicate: true };
      }
      const metadata: MapAssetMetadata = {
        schemaVersion: 1, id, checksumSha256, originalName: safeOriginalName(originalName), format: inspection.format,
        mediaType: inspection.mediaType, extension: inspection.extension, width: inspection.width, height: inspection.height,
        byteLength: inspection.byteLength, animated: inspection.animated, importedAt: new Date(this.now()).toISOString()
      };
      const originalPath = join(this.originalDirectory, `${id}.${inspection.extension}`);
      const metadataPath = join(this.metadataDirectory, `${id}.json`);
      const tempOriginal = join(this.temporaryDirectory, `${id}-${randomUUID()}.asset`);
      const tempMetadata = join(this.temporaryDirectory, `${id}-${randomUUID()}.json`);
      try {
        await writeFile(tempOriginal, buffer, { flag: "wx", mode: 0o600 });
        await writeFile(tempMetadata, JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
        try { await rename(tempOriginal, originalPath); }
        catch (error) {
          if (!["EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          const existingOriginal = await readFile(originalPath);
          if (createHash("sha256").update(existingOriginal).digest("hex") !== checksumSha256) throw new Error("Existing map asset content does not match its expected checksum.");
          await rm(tempOriginal, { force: true });
        }
        await rename(tempMetadata, metadataPath);
      } catch (error) {
        await Promise.all([rm(tempOriginal, { force: true }), rm(tempMetadata, { force: true })]);
        throw error;
      }
      return { metadata, duplicate: false };
    };
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async get(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) return null;
    try { return validateMetadata(JSON.parse(await readFile(join(this.metadataDirectory, `${id}.json`), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async list() {
    const names = (await readdir(this.metadataDirectory)).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name)).sort();
    return Promise.all(names.map(async (name) => validateMetadata(JSON.parse(await readFile(join(this.metadataDirectory, name), "utf8")))));
  }

  async readOriginal(id: string) {
    const metadata = await this.get(id);
    if (!metadata) return null;
    const buffer = await readFile(join(this.originalDirectory, `${id}.${metadata.extension}`));
    if (createHash("sha256").update(buffer).digest("hex") !== metadata.checksumSha256) throw new Error("Stored map asset checksum does not match its metadata.");
    return buffer;
  }

  private get originalDirectory() { return join(this.rootDirectory, "originals"); }
  private get metadataDirectory() { return join(this.rootDirectory, "metadata"); }
  private get temporaryDirectory() { return join(this.rootDirectory, "temporary"); }
}
