import type { Request, Response } from "express";

/**
 * Sends a stored asset's bytes with an ETag and byte-range support: a browser's media element seeks with ranges,
 * and an image reload is a 304. Never cached: access can be revoked, or what is shown can change, at any time,
 * so authorized bytes must not stay recoverable from a shared screen's cache.
 */
export function sendAssetContent(
  request: Request,
  response: Response,
  asset: Readonly<{ id: string; extension: string; mediaType: string; content: Buffer }>
) {
  const { content } = asset;
  const etag = `"${asset.id}"`;
  response.setHeader("etag", etag);
  response.setHeader("accept-ranges", "bytes");
  response.setHeader("content-type", asset.mediaType);
  response.setHeader("content-disposition", `inline; filename="${asset.id}.${asset.extension}"`);
  response.setHeader("cache-control", "private, no-store");
  if (request.header("if-none-match") === etag) return response.status(304).end();
  const range = request.header("range");
  if (!range) {
    response.setHeader("content-length", content.length);
    return response.send(content);
  }
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  let start: number;
  let end: number;
  if (!match || (!match[1] && !match[2])) {
    response.setHeader("content-range", `bytes */${content.length}`);
    return response.status(416).end();
  }
  if (!match[1]) {
    start = Math.max(0, content.length - Number(match[2]));
    end = content.length - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : content.length - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= content.length ||
    end < start
  ) {
    response.setHeader("content-range", `bytes */${content.length}`);
    return response.status(416).end();
  }
  end = Math.min(end, content.length - 1);
  const part = content.subarray(start, end + 1);
  response.status(206).setHeader("content-range", `bytes ${start}-${end}/${content.length}`);
  response.setHeader("content-length", part.length);
  return response.send(part);
}
