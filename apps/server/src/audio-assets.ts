import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InvalidRequestError } from "./invalid-request.js";
import { deterministicAssetId, safeOriginalName } from "./map-assets.js";

/**
 * Sound files the GM uploads for the table screen. Like map images (`map-assets.ts`), a file is identified by
 * its bytes, never its name: the container is sniffed, then walked far enough to read its length and to refuse
 * a file cut short. Nothing here decodes audio; the table screen's browser does that.
 */

export type AudioFormat = "mp3" | "aac" | "m4a" | "ogg" | "wav" | "webm" | "flac";
export type AudioCodec = "mp3" | "aac" | "vorbis" | "opus" | "pcm" | "flac";
export type AudioMediaType =
  "audio/mpeg" | "audio/aac" | "audio/mp4" | "audio/ogg" | "audio/wav" | "audio/webm" | "audio/flac";

export type AudioInspection = Readonly<{
  format: AudioFormat;
  codec: AudioCodec;
  mediaType: AudioMediaType;
  extension: AudioFormat;
  durationMs: number;
  byteLength: number;
}>;

export type AudioAssetMetadata = Readonly<{
  schemaVersion: 1;
  id: string;
  checksumSha256: string;
  originalName: string;
  format: AudioFormat;
  codec: AudioCodec;
  mediaType: AudioMediaType;
  extension: AudioFormat;
  durationMs: number;
  byteLength: number;
  importedAt: string;
}>;

/** 50 MB holds about 50 minutes of 128 kbps MP3 or 5 minutes of CD-quality WAV. The upload sits in the GM
 *  laptop's memory while it is checked, and the table screen downloads it over Wi-Fi before it plays, so a
 *  bigger file buys a long wait at the table and no better sound. */
export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;
/** Longer than any session; a larger figure is a header lying about its length. */
const MAX_DURATION_MS = 12 * 60 * 60 * 1_000;

const FORMATS: Readonly<Record<AudioFormat, AudioMediaType>> = {
  mp3: "audio/mpeg",
  aac: "audio/aac",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
  flac: "audio/flac"
};
const CODECS: Readonly<Record<AudioFormat, readonly AudioCodec[]>> = {
  mp3: ["mp3"],
  aac: ["aac"],
  m4a: ["aac"],
  ogg: ["vorbis", "opus"],
  wav: ["pcm"],
  webm: ["vorbis", "opus"],
  flac: ["flac"]
};

const SUPPORTED = "Use MP3, Ogg (Vorbis or Opus), WAV, M4A or AAC, WebM audio, or FLAC.";
const INCOMPLETE = "The sound file is incomplete; it may not have finished downloading. Save it again and re-upload.";
const NO_LENGTH = "The length of this sound could not be read. Export it again, for example as MP3 or Ogg.";
const VIDEO = "This file holds video. Upload a sound file instead: MP3, Ogg, WAV, M4A, WebM audio or FLAC.";

const incomplete = () => new InvalidRequestError(INCOMPLETE);
const damaged = (format: string) =>
  new InvalidRequestError(`The ${format} file is damaged and can't be read. Export it again and re-upload.`);

function ascii(buffer: Buffer, start: number, end: number) {
  return buffer.subarray(start, Math.min(end, buffer.length)).toString("latin1");
}

type Found = Readonly<{ format: AudioFormat; codec: AudioCodec; seconds: number }>;

// ---------- WAV ----------

function inspectWav(buffer: Buffer): Found | null {
  if (buffer.length < 12 || ascii(buffer, 0, 4) !== "RIFF" || ascii(buffer, 8, 12) !== "WAVE") return null;
  const riffSize = buffer.readUInt32LE(4);
  // A WAV written to a pipe cannot go back to fill in its sizes, so 0 and 0xFFFFFFFF mean "to the end".
  const unknownSize = (size: number) => size === 0 || size === 0xffffffff;
  const end = unknownSize(riffSize) ? buffer.length : riffSize + 8;
  if (end > buffer.length) throw incomplete();
  let offset = 12;
  let format: Readonly<{ code: number; channels: number; sampleRate: number; blockAlign: number }> | null = null;
  let dataBytes: number | null = null;
  while (offset + 8 <= end) {
    const id = ascii(buffer, offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "data") {
      const dataEnd = unknownSize(size) ? end : body + size;
      if (dataEnd > buffer.length) throw incomplete();
      dataBytes = dataEnd - body;
      if (format || unknownSize(size)) break;
    } else {
      if (body + size > end) throw incomplete();
      if (id === "fmt ") {
        if (size < 16) throw damaged("WAV");
        let code = buffer.readUInt16LE(body);
        // WAVE_FORMAT_EXTENSIBLE names the real format in the first two bytes of its sub-format GUID.
        if (code === 0xfffe && size >= 40) code = buffer.readUInt16LE(body + 24);
        format = {
          code,
          channels: buffer.readUInt16LE(body + 2),
          sampleRate: buffer.readUInt32LE(body + 4),
          blockAlign: buffer.readUInt16LE(body + 12)
        };
      }
    }
    offset = body + size + (size & 1);
  }
  if (!format) throw damaged("WAV");
  if (format.code !== 1 && format.code !== 3)
    throw new InvalidRequestError(
      "This WAV file uses a compression browsers can't play. Save it as plain PCM WAV, MP3 or Ogg."
    );
  if (format.channels < 1 || format.sampleRate < 1_000 || format.sampleRate > 768_000 || format.blockAlign < 1)
    throw damaged("WAV");
  if (dataBytes === null) throw incomplete();
  return { format: "wav", codec: "pcm", seconds: dataBytes / (format.blockAlign * format.sampleRate) };
}

// ---------- FLAC ----------

const CRC8 = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  return crc;
});
const CRC16 = Array.from({ length: 256 }, (_, n) => {
  let crc = n << 8;
  for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
  return crc;
});

/** Where a FLAC frame header starting at `offset` ends (at its CRC-8 byte), or -1 when the bytes there are not one. */
function flacHeaderEnd(buffer: Buffer, offset: number) {
  if (offset + 6 > buffer.length || buffer[offset] !== 0xff || (buffer[offset + 1] & 0xfe) !== 0xf8) return -1;
  const blockCode = buffer[offset + 2] >> 4;
  const rateCode = buffer[offset + 2] & 0x0f;
  const channels = buffer[offset + 3] >> 4;
  const sizeCode = (buffer[offset + 3] >> 1) & 0x07;
  if (blockCode === 0 || rateCode === 15 || channels > 10 || sizeCode === 3 || (buffer[offset + 3] & 1) !== 0)
    return -1;
  // The frame or sample number is UTF-8 coded: the lead byte's high bits give the length.
  const lead = buffer[offset + 4];
  let length = 1;
  if (lead >= 0x80) {
    if (lead < 0xc0 || lead === 0xff) return -1;
    while (length < 7 && lead & (0x80 >> length)) length++;
  }
  let cursor = offset + 4 + length;
  for (let index = offset + 5; index < cursor; index++) if ((buffer[index] & 0xc0) !== 0x80) return -1;
  if (blockCode === 6) cursor += 1;
  else if (blockCode === 7) cursor += 2;
  if (rateCode === 12) cursor += 1;
  else if (rateCode === 13 || rateCode === 14) cursor += 2;
  if (cursor >= buffer.length) return -1;
  let crc = 0;
  for (let index = offset; index < cursor; index++) crc = CRC8[crc ^ buffer[index]];
  return crc === buffer[cursor] ? cursor : -1;
}

/** Where the last FLAC frame starts, or -1 when it is cut short: its CRC-16 covers the frame up to the file's final
 *  two bytes. Frames have no length field, so the last one is found by searching back for a header whose CRC-8
 *  checks out. */
function flacLastFrame(buffer: Buffer, audioStart: number, maxFrameSize: number) {
  let end = buffer.length;
  if (end - 128 > audioStart && ascii(buffer, end - 128, end - 125) === "TAG") end -= 128;
  const window = maxFrameSize > 0 ? maxFrameSize * 2 + 64 : 1 << 20;
  const lowest = Math.max(audioStart, end - window);
  const expected = buffer.readUInt16BE(end - 2);
  for (let offset = end - 8; offset >= lowest; offset--) {
    if (buffer[offset] !== 0xff || flacHeaderEnd(buffer, offset) < 0) continue;
    let crc = 0;
    for (let index = offset; index < end - 2; index++) crc = ((crc << 8) & 0xffff) ^ CRC16[(crc >> 8) ^ buffer[index]];
    if (crc === expected) return offset;
  }
  return -1;
}

/** The samples up to the end of the frame at `offset`, for a stream whose header doesn't count them (a FLAC
 *  written to a pipe). The frame names its first sample, or its frame number when every block is one size. */
function flacSamplesThrough(buffer: Buffer, offset: number, fixedBlockSize: number) {
  const variable = (buffer[offset + 1] & 0x01) === 1;
  const lead = buffer[offset + 4];
  let length = 1;
  let number = lead;
  if (lead >= 0x80) {
    while (length < 7 && lead & (0x80 >> length)) length++;
    number = lead & (0xff >> (length + 1));
    for (let index = 1; index < length; index++) number = number * 64 + (buffer[offset + 4 + index] & 0x3f);
  }
  const blockCode = buffer[offset + 2] >> 4;
  const extra = offset + 4 + length;
  const blockSize =
    blockCode === 1
      ? 192
      : blockCode <= 5
        ? 576 * 2 ** (blockCode - 2)
        : blockCode === 6
          ? buffer[extra] + 1
          : blockCode === 7
            ? buffer.readUInt16BE(extra) + 1
            : 256 * 2 ** (blockCode - 8);
  return (variable ? number : number * fixedBlockSize) + blockSize;
}

function inspectFlac(buffer: Buffer): Found | null {
  if (ascii(buffer, 0, 4) !== "fLaC") return null;
  let offset = 4;
  let last = false;
  let info: Readonly<{ blockSize: number; sampleRate: number; totalSamples: number; maxFrameSize: number }> | null =
    null;
  while (!last) {
    if (offset + 4 > buffer.length) throw incomplete();
    last = (buffer[offset] & 0x80) !== 0;
    const type = buffer[offset] & 0x7f;
    const length = buffer.readUIntBE(offset + 1, 3);
    const body = offset + 4;
    if (body + length > buffer.length) throw incomplete();
    if ((offset === 4) !== (type === 0) || type === 127) throw damaged("FLAC");
    if (type === 0) {
      if (length < 34) throw damaged("FLAC");
      info = {
        blockSize: buffer.readUInt16BE(body),
        maxFrameSize: buffer.readUIntBE(body + 7, 3),
        sampleRate: (buffer[body + 10] << 12) | (buffer[body + 11] << 4) | (buffer[body + 12] >> 4),
        totalSamples: (buffer[body + 13] & 0x0f) * 2 ** 32 + buffer.readUInt32BE(body + 14)
      };
    }
    offset = body + length;
  }
  if (!info || info.sampleRate < 1) throw damaged("FLAC");
  if (offset + 2 > buffer.length || buffer[offset] !== 0xff || (buffer[offset + 1] & 0xfe) !== 0xf8) throw incomplete();
  const lastFrame = flacLastFrame(buffer, offset, info.maxFrameSize);
  if (lastFrame < 0) throw incomplete();
  const samples = info.totalSamples || flacSamplesThrough(buffer, lastFrame, info.blockSize);
  return { format: "flac", codec: "flac", seconds: samples / info.sampleRate };
}

// ---------- Ogg ----------

function inspectOgg(buffer: Buffer): Found | null {
  if (ascii(buffer, 0, 4) !== "OggS") return null;
  let offset = 0;
  let pages = 0;
  let serial = -1;
  let codec: "vorbis" | "opus" | null = null;
  let rate = 0;
  let preSkip = 0;
  let lastGranule = -1n;
  let ended = false;
  while (offset < buffer.length) {
    if (offset + 27 > buffer.length) throw incomplete();
    if (ascii(buffer, offset, offset + 4) !== "OggS" || buffer[offset + 4] !== 0) throw damaged("Ogg");
    const flags = buffer[offset + 5];
    const granule = buffer.readBigInt64LE(offset + 6);
    const pageSerial = buffer.readUInt32LE(offset + 14);
    const segments = buffer[offset + 26];
    const bodyStart = offset + 27 + segments;
    if (bodyStart > buffer.length) throw incomplete();
    let bodyLength = 0;
    for (let index = offset + 27; index < bodyStart; index++) bodyLength += buffer[index];
    const pageEnd = bodyStart + bodyLength;
    if (pageEnd > buffer.length) throw incomplete();
    const beginsStream = (flags & 0x02) !== 0;
    if (pages === 0 || (beginsStream && pageSerial !== serial)) {
      const packet = buffer.subarray(bodyStart, pageEnd);
      if (ascii(packet, 0, 7) === "\x80theora") throw new InvalidRequestError(VIDEO);
      if (pages > 0) throw new InvalidRequestError("This Ogg file holds more than one stream. Export it as one track.");
      if (!beginsStream) throw damaged("Ogg");
      serial = pageSerial;
      if (ascii(packet, 0, 7) === "\x01vorbis" && packet.length >= 16) {
        codec = "vorbis";
        rate = packet.readUInt32LE(12);
      } else if (ascii(packet, 0, 8) === "OpusHead" && packet.length >= 19) {
        codec = "opus";
        rate = 48_000; // Opus granules always count 48 kHz samples, whatever the input rate was.
        preSkip = packet.readUInt16LE(10);
      } else throw new InvalidRequestError(`This Ogg file holds a sound format browsers don't play. ${SUPPORTED}`);
      if (rate < 1) throw damaged("Ogg");
    }
    if (pageSerial === serial) {
      if (granule >= 0n) lastGranule = granule;
      if (flags & 0x04) ended = true;
    }
    pages++;
    offset = pageEnd;
  }
  // The last page of a whole stream carries the end-of-stream flag; a file cut on a page boundary does not.
  if (!ended || !codec) throw incomplete();
  const samples = Number(lastGranule) - preSkip;
  if (samples <= 0) throw new InvalidRequestError(NO_LENGTH);
  return { format: "ogg", codec, seconds: samples / rate };
}

// ---------- MP4 / M4A ----------

type Box = Readonly<{ type: string; start: number; body: number; end: number }>;

/** The boxes directly inside [start, end). A box running past its parent means the file was cut short. */
function boxes(buffer: Buffer, start: number, end: number): Box[] {
  const found: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = ascii(buffer, offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) throw incomplete();
      size = Number(buffer.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header) throw damaged("M4A");
    if (offset + size > end) throw incomplete();
    found.push({ type, start: offset, body: offset + header, end: offset + size });
    offset += size;
  }
  if (offset !== end && end - offset >= 8) throw damaged("M4A");
  return found;
}

const child = (buffer: Buffer, parent: Box, type: string) =>
  boxes(buffer, parent.body, parent.end).find((box) => box.type === type);

/** A movie or media header's duration in seconds: version 1 widens the times to 64 bits. */
function headerSeconds(buffer: Buffer, box: Box) {
  const version = buffer[box.body];
  const timescale = buffer.readUInt32BE(box.body + (version === 1 ? 20 : 12));
  const duration = version === 1 ? Number(buffer.readBigUInt64BE(box.body + 24)) : buffer.readUInt32BE(box.body + 16);
  return timescale > 0 && duration > 0 && duration !== 0xffffffff ? duration / timescale : 0;
}

/** A fragmented file (one recorded in a browser, or written to a pipe) has no length in its movie header; its
 *  fragments' sample durations add up to it, in the sound track's own timescale. */
function fragmentedSeconds(buffer: Buffer, top: readonly Box[], moov: Box) {
  const trak = boxes(buffer, moov.body, moov.end).find((box) => box.type === "trak");
  const mdia = trak && child(buffer, trak, "mdia");
  const mdhd = mdia && child(buffer, mdia, "mdhd");
  if (!mdhd) return 0;
  const timescale = buffer.readUInt32BE(mdhd.body + (buffer[mdhd.body] === 1 ? 20 : 12));
  const mvex = child(buffer, moov, "mvex");
  const trex = mvex && child(buffer, mvex, "trex");
  const trackDefault = trex ? buffer.readUInt32BE(trex.body + 12) : 0;
  let units = 0;
  for (const moof of top.filter((box) => box.type === "moof"))
    for (const traf of boxes(buffer, moof.body, moof.end).filter((box) => box.type === "traf")) {
      const tfhd = child(buffer, traf, "tfhd");
      let fallback = trackDefault;
      if (tfhd) {
        const flags = buffer.readUIntBE(tfhd.body + 1, 3);
        // Optional fields in order: base data offset (8), sample description index (4), then the default duration.
        const at = tfhd.body + 8 + (flags & 0x01 ? 8 : 0) + (flags & 0x02 ? 4 : 0);
        if (flags & 0x08) fallback = buffer.readUInt32BE(at);
      }
      for (const trun of boxes(buffer, traf.body, traf.end).filter((box) => box.type === "trun")) {
        const flags = buffer.readUIntBE(trun.body + 1, 3);
        const count = buffer.readUInt32BE(trun.body + 4);
        if (!(flags & 0x100)) {
          units += count * fallback;
          continue;
        }
        const stride = 4 * [0x100, 0x200, 0x400, 0x800].filter((bit) => flags & bit).length;
        let at = trun.body + 8 + (flags & 0x01 ? 4 : 0) + (flags & 0x04 ? 4 : 0);
        for (let index = 0; index < count && at + 4 <= trun.end; index++, at += stride)
          units += buffer.readUInt32BE(at);
      }
    }
  return timescale > 0 ? units / timescale : 0;
}

function inspectMp4(buffer: Buffer): Found | null {
  if (buffer.length < 12 || ascii(buffer, 4, 8) !== "ftyp") return null;
  const top = boxes(buffer, 0, buffer.length);
  const moov = top.find((box) => box.type === "moov");
  // A file cut before its index (written last by most encoders) or its sound data is a half download.
  if (!moov || !top.some((box) => box.type === "mdat")) throw incomplete();
  let seconds = 0;
  const mvhd = child(buffer, moov, "mvhd");
  if (mvhd) seconds = headerSeconds(buffer, mvhd);
  const codecs: string[] = [];
  for (const trak of boxes(buffer, moov.body, moov.end).filter((box) => box.type === "trak")) {
    const mdia = child(buffer, trak, "mdia");
    const hdlr = mdia && child(buffer, mdia, "hdlr");
    if (!mdia || !hdlr) continue;
    const handler = ascii(buffer, hdlr.body + 8, hdlr.body + 12);
    if (handler === "vide") throw new InvalidRequestError(VIDEO);
    if (handler !== "soun") continue;
    const mdhd = child(buffer, mdia, "mdhd");
    if (!seconds && mdhd) seconds = headerSeconds(buffer, mdhd);
    const minf = child(buffer, mdia, "minf");
    const stbl = minf && child(buffer, minf, "stbl");
    const stsd = stbl && child(buffer, stbl, "stsd");
    if (stsd && stsd.body + 16 <= stsd.end) codecs.push(ascii(buffer, stsd.body + 12, stsd.body + 16));
  }
  if (!seconds) seconds = fragmentedSeconds(buffer, top, moov);
  if (codecs.length === 0) throw new InvalidRequestError(`This file has no sound track. ${SUPPORTED}`);
  if (codecs[0] === "alac")
    throw new InvalidRequestError("Apple Lossless doesn't play in most browsers. Export the sound as AAC or MP3.");
  if (codecs[0] !== "mp4a")
    throw new InvalidRequestError(`This M4A file holds a sound format browsers don't play. ${SUPPORTED}`);
  if (!seconds) throw new InvalidRequestError(NO_LENGTH);
  return { format: "m4a", codec: "aac", seconds };
}

// ---------- WebM ----------

const EBML_HEADER = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
/** The elements a cluster holds; with an unknown size, a cluster ends at the first element not in this set. */
const CLUSTER_CHILDREN = new Set([0xe7, 0xa3, 0xa0, 0xa7, 0xab, 0x5854, 0xaf, 0xbf, 0xec]);

type Element = Readonly<{ id: number; body: number; end: number; unknownSize: boolean }>;

/** One EBML element header at `offset`. An ID keeps its length marker; a size drops it. */
function ebmlElement(buffer: Buffer, offset: number, parentEnd: number): Element {
  const idLead = buffer[offset];
  const idLength = Math.clz32(idLead) - 23;
  if (idLength < 1 || idLength > 4) throw damaged("WebM");
  if (offset + idLength >= parentEnd) throw incomplete();
  let id = 0;
  for (let index = 0; index < idLength; index++) id = id * 256 + buffer[offset + index];
  const sizeAt = offset + idLength;
  const sizeLead = buffer[sizeAt];
  const sizeLength = Math.clz32(sizeLead) - 23;
  if (sizeLength < 1 || sizeLength > 8) throw damaged("WebM");
  if (sizeAt + sizeLength > parentEnd) throw incomplete();
  let size = sizeLead & (0xff >> sizeLength);
  let allOnes = size === 0xff >> sizeLength;
  for (let index = 1; index < sizeLength; index++) {
    const byte = buffer[sizeAt + index];
    size = size * 256 + byte;
    allOnes &&= byte === 0xff;
  }
  const body = sizeAt + sizeLength;
  if (allOnes) return { id, body, end: parentEnd, unknownSize: true };
  if (body + size > parentEnd) throw incomplete();
  return { id, body, end: body + size, unknownSize: false };
}

function ebmlUint(buffer: Buffer, element: Element) {
  let value = 0;
  for (let index = element.body; index < element.end; index++) value = value * 256 + buffer[index];
  return value;
}

/** The track number and relative timecode a (Simple)Block starts with. */
function blockTimecode(buffer: Buffer, element: Element) {
  const lead = buffer[element.body];
  const length = Math.clz32(lead) - 23;
  if (length < 1 || length > 8 || element.body + length + 2 > element.end) throw damaged("WebM");
  return buffer.readInt16BE(element.body + length);
}

function inspectWebm(buffer: Buffer): Found | null {
  if (buffer.length < 4 || buffer.readUInt32BE(0) !== EBML_HEADER) return null;
  const header = ebmlElement(buffer, 0, buffer.length);
  let docType = "";
  for (let offset = header.body; offset < header.end;) {
    const element = ebmlElement(buffer, offset, header.end);
    if (element.id === 0x4282) docType = ascii(buffer, element.body, element.end).replace(/\0+$/, "");
    offset = element.end;
  }
  if (docType !== "webm")
    throw new InvalidRequestError(`Only WebM files are supported, not ${docType || "this EBML type"}. ${SUPPORTED}`);
  if (header.end >= buffer.length) throw incomplete();
  const segment = ebmlElement(buffer, header.end, buffer.length);
  if (segment.id !== SEGMENT) throw damaged("WebM");
  let scale = 1_000_000;
  let declared = 0;
  let audioCodec: "opus" | "vorbis" | null = null;
  let otherCodec = false;
  let latest = -1;
  for (let offset = segment.body; offset < segment.end;) {
    const element = ebmlElement(buffer, offset, segment.end);
    if (element.unknownSize && element.id !== CLUSTER) throw damaged("WebM");
    let end = element.end;
    if (element.id === 0x1549a966) {
      for (let at = element.body; at < element.end;) {
        const field = ebmlElement(buffer, at, element.end);
        if (field.id === 0x2ad7b1) scale = ebmlUint(buffer, field);
        if (field.id === 0x4489)
          declared = field.end - field.body === 4 ? buffer.readFloatBE(field.body) : buffer.readDoubleBE(field.body);
        at = field.end;
      }
    } else if (element.id === 0x1654ae6b) {
      for (let at = element.body; at < element.end;) {
        const entry = ebmlElement(buffer, at, element.end);
        if (entry.id === 0xae) {
          let type = 0;
          let codecId = "";
          for (let inner = entry.body; inner < entry.end;) {
            const field = ebmlElement(buffer, inner, entry.end);
            if (field.id === 0x83) type = ebmlUint(buffer, field);
            if (field.id === 0x86) codecId = ascii(buffer, field.body, field.end);
            inner = field.end;
          }
          if (type === 1) throw new InvalidRequestError(VIDEO);
          if (type === 2) {
            if (codecId === "A_OPUS") audioCodec ??= "opus";
            else if (codecId === "A_VORBIS") audioCodec ??= "vorbis";
            else otherCodec = true;
          }
        }
        at = entry.end;
      }
    } else if (element.id === CLUSTER) {
      let base = 0;
      let at = element.body;
      while (at < element.end) {
        if (element.unknownSize && at + 1 < buffer.length) {
          const peek = ebmlElement(buffer, at, element.end);
          if (!CLUSTER_CHILDREN.has(peek.id)) break;
        }
        const field = ebmlElement(buffer, at, element.end);
        if (field.unknownSize) throw damaged("WebM");
        if (field.id === 0xe7) base = ebmlUint(buffer, field);
        if (field.id === 0xa3) latest = Math.max(latest, base + blockTimecode(buffer, field));
        if (field.id === 0xa0)
          for (let inner = field.body; inner < field.end;) {
            const block = ebmlElement(buffer, inner, field.end);
            if (block.id === 0xa1) latest = Math.max(latest, base + blockTimecode(buffer, block));
            inner = block.end;
          }
        at = field.end;
      }
      end = at;
    }
    offset = end;
  }
  if (!audioCodec)
    throw new InvalidRequestError(
      otherCodec ? `This WebM file holds a sound format browsers don't play. ${SUPPORTED}` : "This file has no sound."
    );
  if (latest < 0) throw incomplete();
  // A recording made in a browser often has no stated length; its last block's time stands in for it.
  const seconds = ((declared > 0 ? declared : latest) * scale) / 1e9;
  return { format: "webm", codec: audioCodec, seconds };
}

// ---------- MP3 and ADTS AAC ----------

type Frame = Readonly<{ length: number; samples: number; sampleRate: number; aac: boolean }>;

const MP3_BITRATES = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
};
const MP3_RATES = [[11_025, 12_000, 8_000], null, [22_050, 24_000, 16_000], [44_100, 48_000, 32_000]] as const;
const AAC_RATES = [
  96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000, 7_350
];

/** An MPEG Layer III or ADTS AAC frame header at `offset`, or null. */
function audioFrame(buffer: Buffer, offset: number): Frame | null {
  if (offset + 7 > buffer.length || buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) return null;
  const layer = (buffer[offset + 1] >> 1) & 0x03;
  if (layer === 0) {
    // ADTS: twelve sync bits, then MPEG version and a layer of zero.
    if ((buffer[offset + 1] & 0xf6) !== 0xf0) return null;
    const rateIndex = (buffer[offset + 2] >> 2) & 0x0f;
    const length = ((buffer[offset + 3] & 0x03) << 11) | (buffer[offset + 4] << 3) | (buffer[offset + 5] >> 5);
    const headerLength = buffer[offset + 1] & 0x01 ? 7 : 9;
    if (rateIndex >= AAC_RATES.length || length < headerLength) return null;
    return { length, samples: 1024 * ((buffer[offset + 6] & 0x03) + 1), sampleRate: AAC_RATES[rateIndex], aac: true };
  }
  const version = (buffer[offset + 1] >> 3) & 0x03;
  const rates = MP3_RATES[version];
  // Layer III only: Layer I and II are not MP3.
  if (!rates || layer !== 1) return null;
  const bitrateIndex = buffer[offset + 2] >> 4;
  const rateIndex = (buffer[offset + 2] >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const sampleRate = rates[rateIndex];
  const kbps = (version === 3 ? MP3_BITRATES.v1 : MP3_BITRATES.v2)[bitrateIndex];
  const padding = (buffer[offset + 2] >> 1) & 0x01;
  const length = Math.floor(((version === 3 ? 144_000 : 72_000) * kbps) / sampleRate) + padding;
  return { length, samples: version === 3 ? 1152 : 576, sampleRate, aac: false };
}

/** A frame at `offset` that a second frame of the same kind follows: one header alone is too easy to fake. */
function confirmedFrame(buffer: Buffer, offset: number, end: number) {
  const frame = audioFrame(buffer, offset);
  if (!frame) return null;
  if (offset + frame.length === end) return frame;
  const next = audioFrame(buffer, offset + frame.length);
  return next && next.aac === frame.aac ? frame : null;
}

function inspectMpeg(buffer: Buffer): Found | null {
  let start = 0;
  let tagged = false;
  // ID3v2 tags sit in front of the first frame: ten header bytes, a syncsafe size, and an optional footer.
  while (ascii(buffer, start, start + 3) === "ID3") {
    if (start + 10 > buffer.length) throw incomplete();
    const size =
      ((buffer[start + 6] & 0x7f) << 21) |
      ((buffer[start + 7] & 0x7f) << 14) |
      ((buffer[start + 8] & 0x7f) << 7) |
      (buffer[start + 9] & 0x7f);
    start += 10 + size + (buffer[start + 5] & 0x10 ? 10 : 0);
    tagged = true;
  }
  if (start > buffer.length) throw incomplete();
  while (start < buffer.length && buffer[start] === 0) start++;
  // Tags at the end are not frames: ID3v1 is the last 128 bytes, and an APE tag ends in a 32-byte footer.
  let end = buffer.length;
  if (end - 128 >= start && ascii(buffer, end - 128, end - 125) === "TAG") end -= 128;
  if (end - 32 >= start && ascii(buffer, end - 32, end - 24) === "APETAGEX") {
    const size = buffer.readUInt32LE(end - 20);
    const hasHeader = (buffer.readUInt32LE(end - 12) & 0x80000000) !== 0;
    end = Math.max(start, end - size - (hasHeader ? 32 : 0));
  }
  const first = confirmedFrame(buffer, start, end);
  if (!first) {
    if (tagged && start >= buffer.length) throw incomplete();
    return null;
  }
  let seconds = 0;
  let offset = start;
  while (offset < end) {
    const frame = audioFrame(buffer, offset);
    if (!frame || frame.aac !== first.aac) {
      // A stray byte run between frames: carry on from the next pair of frames, or stop if there is none.
      let next = offset + 1;
      while (next < end && !confirmedFrame(buffer, next, end)) next++;
      if (next >= end) break;
      offset = next;
      continue;
    }
    if (offset + frame.length > end) throw incomplete();
    seconds += frame.samples / frame.sampleRate;
    offset += frame.length;
  }
  return first.aac ? { format: "aac", codec: "aac", seconds } : { format: "mp3", codec: "mp3", seconds };
}

// ---------- Sniffing ----------

/** What a file that isn't sound looks like, for a refusal that says what was uploaded. */
function otherKind(buffer: Buffer) {
  const head = ascii(buffer, 0, 12);
  if (
    head.startsWith("\x89PNG") ||
    head.startsWith("GIF8") ||
    (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP")
  )
    return "an image";
  if (head.startsWith("%PDF")) return "a PDF document";
  if (head.startsWith("PK\x03\x04")) return "a zip archive";
  if (head.startsWith("RIFF") && head.slice(8, 11) === "AVI") return "a video";
  return null;
}

export function inspectAudio(input: Uint8Array, maxBytes = AUDIO_MAX_BYTES): AudioInspection {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buffer.length === 0) throw new InvalidRequestError("The sound file is empty.");
  if (buffer.length > maxBytes)
    throw new InvalidRequestError(`The sound file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
  const found =
    inspectWav(buffer) ??
    inspectFlac(buffer) ??
    inspectOgg(buffer) ??
    inspectWebm(buffer) ??
    inspectMp4(buffer) ??
    inspectMpeg(buffer);
  if (!found) {
    const kind = otherKind(buffer);
    throw new InvalidRequestError(
      kind
        ? `This file is ${kind}, and only sound files can be uploaded here. ${SUPPORTED}`
        : `This is not a sound file browsers can play. ${SUPPORTED}`
    );
  }
  const durationMs = Math.round(found.seconds * 1_000);
  if (!Number.isFinite(durationMs) || durationMs < 1) throw new InvalidRequestError(NO_LENGTH);
  if (durationMs > MAX_DURATION_MS) throw damaged(found.format.toUpperCase());
  return {
    format: found.format,
    codec: found.codec,
    mediaType: FORMATS[found.format],
    extension: found.format,
    durationMs,
    byteLength: buffer.length
  };
}

// ---------- Storage ----------

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function validateMetadata(value: unknown): AudioAssetMetadata {
  const metadata = (value ?? {}) as Partial<AudioAssetMetadata>;
  const format = metadata.format;
  if (
    metadata.schemaVersion !== 1 ||
    typeof metadata.id !== "string" ||
    !ASSET_ID.test(metadata.id) ||
    typeof metadata.checksumSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(metadata.checksumSha256) ||
    typeof metadata.originalName !== "string" ||
    metadata.originalName.length < 1 ||
    metadata.originalName.length > 200 ||
    typeof format !== "string" ||
    !(format in FORMATS) ||
    metadata.mediaType !== FORMATS[format] ||
    metadata.extension !== format ||
    !CODECS[format].includes(metadata.codec as AudioCodec) ||
    !Number.isInteger(metadata.durationMs) ||
    (metadata.durationMs ?? 0) < 1 ||
    !Number.isInteger(metadata.byteLength) ||
    (metadata.byteLength ?? 0) < 1 ||
    typeof metadata.importedAt !== "string" ||
    !Number.isFinite(Date.parse(metadata.importedAt))
  )
    throw new Error("Sound asset metadata is malformed.");
  return metadata as AudioAssetMetadata;
}

/** Sound files on disk, content-addressed like map images: one file per distinct set of bytes, plus a JSON
 *  record of what the inspection found. Writes are serialized through one queue. */
export class AudioAssetStore {
  private operationQueue: Promise<void> = Promise.resolve();
  constructor(
    private readonly rootDirectory: string,
    private readonly maxBytes = AUDIO_MAX_BYTES,
    private readonly now: () => number = Date.now
  ) {}

  async initialize() {
    await Promise.all(
      [this.originalDirectory, this.metadataDirectory, this.temporaryDirectory].map((path) =>
        mkdir(path, { recursive: true })
      )
    );
  }

  import(input: Uint8Array, originalName: string) {
    return this.serialized(async () => {
      const inspection = inspectAudio(input, this.maxBytes);
      const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
      const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
      const id = deterministicAssetId(checksumSha256);
      const existing = await this.get(id);
      if (existing) {
        if (existing.checksumSha256 !== checksumSha256) throw new Error("Sound asset identifier collision detected.");
        return { metadata: existing, duplicate: true };
      }
      const metadata: AudioAssetMetadata = {
        schemaVersion: 1,
        id,
        checksumSha256,
        originalName: safeOriginalName(originalName, "sound"),
        format: inspection.format,
        codec: inspection.codec,
        mediaType: inspection.mediaType,
        extension: inspection.extension,
        durationMs: inspection.durationMs,
        byteLength: inspection.byteLength,
        importedAt: new Date(this.now()).toISOString()
      };
      const temporaryOriginal = join(this.temporaryDirectory, `${id}-${randomUUID()}.asset`);
      const temporaryMetadata = join(this.temporaryDirectory, `${id}-${randomUUID()}.json`);
      try {
        await writeFile(temporaryOriginal, buffer, { flag: "wx", mode: 0o600 });
        await writeFile(temporaryMetadata, JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
        await rename(temporaryOriginal, join(this.originalDirectory, `${id}.${metadata.extension}`));
        await rename(temporaryMetadata, join(this.metadataDirectory, `${id}.json`));
      } catch (error) {
        await Promise.all([rm(temporaryOriginal, { force: true }), rm(temporaryMetadata, { force: true })]);
        throw error;
      }
      return { metadata, duplicate: false };
    });
  }

  async get(id: string) {
    if (!ASSET_ID.test(id)) return null;
    try {
      return validateMetadata(JSON.parse(await readFile(join(this.metadataDirectory, `${id}.json`), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async list() {
    const names = (await readdir(this.metadataDirectory)).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name)).sort();
    return Promise.all(
      names.map(async (name) =>
        validateMetadata(JSON.parse(await readFile(join(this.metadataDirectory, name), "utf8")))
      )
    );
  }

  async readOriginal(id: string) {
    const metadata = await this.get(id);
    if (!metadata) return null;
    const buffer = await readFile(join(this.originalDirectory, `${id}.${metadata.extension}`));
    if (createHash("sha256").update(buffer).digest("hex") !== metadata.checksumSha256)
      throw new Error("Stored sound asset checksum does not match its metadata.");
    return { metadata, buffer };
  }

  /** Deletes a file and its record; false when it was already gone. */
  remove(id: string) {
    return this.serialized(async () => {
      const metadata = await this.get(id);
      if (!metadata) return false;
      await Promise.all([
        rm(join(this.originalDirectory, `${id}.${metadata.extension}`), { force: true }),
        rm(join(this.metadataDirectory, `${id}.json`), { force: true })
      ]);
      return true;
    });
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private get originalDirectory() {
    return join(this.rootDirectory, "originals");
  }
  private get metadataDirectory() {
    return join(this.rootDirectory, "metadata");
  }
  private get temporaryDirectory() {
    return join(this.rootDirectory, "temporary");
  }
}
