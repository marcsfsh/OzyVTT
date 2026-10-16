/**
 * The smallest PNG the map and token stores accept: the signature, an IHDR chunk with the given size, and the
 * IEND chunk that marks a complete file. There is no pixel data and the CRCs are zero, since nothing in the server
 * decodes the image. `animated` adds an `acTL` chunk, which marks an APNG.
 */
export function png(width: number, height: number, animated = false): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    return Buffer.concat([head, data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(animated ? [chunk("acTL", Buffer.alloc(8))] : []),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
