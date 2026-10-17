/**
 * The smallest sound files the sound library accepts, one per container, built here so the suite carries no
 * binary. Each has the structure the inspector walks (headers, lengths, end markers) around silent or zeroed
 * audio data: nothing on the server decodes sound, so the payload never needs to be real. FLAC frames carry real
 * CRCs because the inspector checks the last one.
 */

/** Copied into one allocated buffer: a `fetch` body needs a Buffer backed by an ArrayBuffer, and concat's isn't. */
function owned(parts: readonly Buffer[]): Buffer<ArrayBuffer> {
  const file = Buffer.alloc(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) offset += part.copy(file, offset);
  return file;
}

/** A PCM WAV of silence: 16-bit mono at `sampleRate`. */
export function wav(seconds: number, sampleRate = 8_000): Buffer<ArrayBuffer> {
  const data = Buffer.alloc(Math.round(seconds * sampleRate) * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8, "latin1");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "latin1");
  head.writeUInt32LE(data.length, 40);
  return owned([head, data]);
}

/** A ten-byte ID3v2.3 tag holding nothing but padding. */
function id3(padding = 22) {
  const head = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  head[9] = padding & 0x7f;
  head[8] = (padding >> 7) & 0x7f;
  return Buffer.concat([head, Buffer.alloc(padding)]);
}

/** MPEG-1 Layer III frames at 128 kbps and 44.1 kHz: 417 bytes and 1152 samples each. */
export function mp3(frames: number, options: Readonly<{ tagged?: boolean; trailer?: boolean }> = {}) {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  const parts = [
    ...(options.tagged ? [id3()] : []),
    ...Array.from({ length: frames }, () => frame),
    ...(options.trailer ? [Buffer.concat([Buffer.from("TAG", "latin1"), Buffer.alloc(125)])] : [])
  ];
  return owned(parts);
}

/** ADTS AAC frames at 44.1 kHz, 1024 samples each. */
export function adts(frames: number) {
  const length = 200;
  const frame = Buffer.alloc(length);
  frame.set([0xff, 0xf1, 0x50, 0x80 | (length >> 11), (length >> 3) & 0xff, ((length & 7) << 5) | 0x1f, 0xfc]);
  return owned(Array.from({ length: frames }, () => frame));
}

function oggPage(flags: number, granule: bigint, sequence: number, body: Buffer) {
  const segments: number[] = [];
  for (let left = body.length; ; left -= 255) {
    segments.push(Math.min(255, left));
    if (left < 255) break;
  }
  const head = Buffer.alloc(27 + segments.length);
  head.write("OggS", 0, "latin1");
  head[5] = flags;
  head.writeBigInt64LE(granule, 6);
  head.writeUInt32LE(0x1234, 14);
  head.writeUInt32LE(sequence, 18);
  head[26] = segments.length;
  head.set(segments, 27);
  return Buffer.concat([head, body]);
}

/** An Ogg stream: Vorbis at 44.1 kHz, or Opus (whose granules count 48 kHz samples after a 312-sample pre-skip). */
export function ogg(codec: "vorbis" | "opus", seconds: number, options: Readonly<{ ended?: boolean }> = {}) {
  const ident =
    codec === "vorbis"
      ? Buffer.concat([
          Buffer.from("\x01vorbis", "latin1"),
          Buffer.from([0, 0, 0, 0, 1, 0x44, 0xac, 0, 0]),
          Buffer.alloc(14)
        ])
      : Buffer.concat([Buffer.from("OpusHead", "latin1"), Buffer.from([1, 1, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0])]);
  const rate = codec === "vorbis" ? 44_100 : 48_000;
  const skip = codec === "opus" ? 312 : 0;
  const granule = BigInt(Math.round(seconds * rate) + skip);
  return owned([
    oggPage(0x02, 0n, 0, ident),
    oggPage(0x00, 0n, 1, Buffer.alloc(40)),
    oggPage(options.ended === false ? 0x00 : 0x04, granule, 2, Buffer.alloc(300))
  ]);
}

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

/** One FLAC frame of 4096 silent mono 16-bit samples: a CONSTANT subframe, with both CRCs. */
function flacFrame(number: number) {
  // 44.1 kHz (code 9), block size 4096 (code 12), mono, 16-bit; the frame number fits one UTF-8 byte below 128.
  const header = [0xff, 0xf8, 0xc9, 0x08, number];
  header.push(header.reduce((crc, byte) => CRC8[crc ^ byte]!, 0));
  const body = [...header, 0x00, 0x00, 0x00];
  const crc = body.reduce((value, byte) => ((value << 8) & 0xffff) ^ CRC16[(value >> 8) ^ byte]!, 0);
  return Buffer.from([...body, crc >> 8, crc & 0xff]);
}

/** A FLAC stream of `frames` 4096-sample frames at 44.1 kHz; `stated: false` leaves the sample count unknown, as a
 *  FLAC written to a pipe does. */
export function flac(frames: number, options: Readonly<{ stated?: boolean }> = {}) {
  const info = Buffer.alloc(38);
  info[0] = 0x80; // last metadata block, STREAMINFO
  info.writeUIntBE(34, 1, 3);
  info.writeUInt16BE(4096, 4);
  info.writeUInt16BE(4096, 6);
  info.writeUIntBE(11, 8, 3);
  info.writeUIntBE(11, 11, 3);
  const samples = options.stated === false ? 0 : frames * 4096;
  // 44100 Hz (20 bits), one channel (3 bits, minus one), 16 bits per sample (5 bits, minus one), the count (36 bits).
  info[14] = 44_100 >> 12;
  info[15] = (44_100 >> 4) & 0xff;
  info[16] = ((44_100 & 0x0f) << 4) | (0 << 1) | (15 >> 4);
  info[17] = ((15 & 0x0f) << 4) | Math.floor(samples / 2 ** 32);
  info.writeUInt32BE(samples % 2 ** 32, 18);
  return owned([
    Buffer.from("fLaC", "latin1"),
    info,
    ...Array.from({ length: frames }, (_, index) => flacFrame(index))
  ]);
}

function box(type: string, ...children: Buffer[]) {
  const body = Buffer.concat(children);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
}

/** A time header (mvhd or mdhd, version 0) for `seconds` at a 1000-unit timescale. */
function timeHeader(type: "mvhd" | "mdhd", seconds: number) {
  const body = Buffer.alloc(type === "mvhd" ? 100 : 24);
  body.writeUInt32BE(1000, 12);
  body.writeUInt32BE(Math.round(seconds * 1000), 16);
  return box(type, body);
}

/** An M4A: a track whose handler is `handler` ("soun", or "vide" for a video) and sample entry is `codec`. */
export function m4a(seconds: number, options: Readonly<{ handler?: string; codec?: string; index?: boolean }> = {}) {
  const hdlr = Buffer.alloc(24);
  hdlr.write(options.handler ?? "soun", 8, "latin1");
  const entry = box(options.codec ?? "mp4a", Buffer.alloc(28));
  const stsd = box("stsd", Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), entry);
  const trak = box("trak", box("mdia", timeHeader("mdhd", seconds), box("hdlr", hdlr), box("minf", box("stbl", stsd))));
  const ftyp = box("ftyp", Buffer.from("M4A \0\0\0\0M4A mp42isom", "latin1"));
  const moov = box("moov", timeHeader("mvhd", seconds), trak);
  return owned([ftyp, ...(options.index === false ? [] : [moov]), box("mdat", Buffer.alloc(256))]);
}

/** An EBML element: its ID bytes, a one-byte size marker, and its body (all bodies here are under 127 bytes). */
function ebml(id: number[], ...children: Buffer[]) {
  const body = Buffer.concat(children);
  const size =
    body.length < 127
      ? Buffer.from([0x80 | body.length])
      : Buffer.from([0x40 | (body.length >> 8), body.length & 0xff]);
  return Buffer.concat([Buffer.from(id), size, body]);
}

/** A WebM: one track of `codec`, one cluster with a block at `seconds`, and the stated duration unless `stated` is
 *  false (a browser recording states none). */
export function webm(
  seconds: number,
  options: Readonly<{ codec?: string; trackType?: number; stated?: boolean }> = {}
) {
  const header = ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], Buffer.from("webm", "latin1")));
  const scale = ebml([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])); // 1 ms per timecode unit
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE(seconds * 1000);
  const info = ebml(
    [0x15, 0x49, 0xa9, 0x66],
    scale,
    ...(options.stated === false ? [] : [ebml([0x44, 0x89], duration)])
  );
  const track = ebml(
    [0xae],
    ebml([0xd7], Buffer.from([1])),
    ebml([0x83], Buffer.from([options.trackType ?? 2])),
    ebml([0x86], Buffer.from(options.codec ?? "A_OPUS", "latin1"))
  );
  const tracks = ebml([0x16, 0x54, 0xae, 0x6b], track);
  const time = Math.round(seconds * 1000);
  const cluster = ebml(
    [0x1f, 0x43, 0xb6, 0x75],
    ebml([0xe7], Buffer.from([0])),
    ebml([0xa3], Buffer.from([0x81, (time >> 8) & 0x7f, time & 0xff, 0x80]), Buffer.alloc(20))
  );
  const segmentBody = Buffer.concat([info, tracks, cluster]);
  const segmentSize = Buffer.alloc(8);
  segmentSize.writeBigUInt64BE(BigInt(segmentBody.length) | 0x0100000000000000n);
  return owned([header, Buffer.from([0x18, 0x53, 0x80, 0x67]), segmentSize, segmentBody]);
}
