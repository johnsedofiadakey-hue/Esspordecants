import { Readable } from "node:stream";
import type { Bucket } from "../firebase.ts";
import { ApiError } from "../lib/errors.ts";
import { newId, now, sha256 } from "../lib/util.ts";

export const IMAGE_ROLES = ["decant-front", "decant-side", "sprayer", "source-bottle", "packaging", "editorial"] as const;
export type ImageRole = (typeof IMAGE_ROLES)[number];

// Roles that show the physical Esspor item and therefore must be real photographs.
export const PHYSICAL_ROLES: ReadonlySet<ImageRole> = new Set(["decant-front", "decant-side", "sprayer", "packaging"]);

// Display order: what the buyer receives first, the original bottle after.
const roleRank: Record<ImageRole, number> = {
  "decant-front": 0,
  "decant-side": 1,
  sprayer: 2,
  packaging: 3,
  "source-bottle": 4,
  editorial: 5,
};

export type MediaKind = "image" | "video";

type Sniffed = { kind: MediaKind; mime: string; ext: string; width: number | null; height: number | null };

export function sniffImage(data: Buffer): Sniffed | null {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: "image", mime: "image/png", ext: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { kind: "image", mime: "image/jpeg", ext: "jpg", ...jpegSize(data) };
  }
  if (data.length >= 30 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return { kind: "image", mime: "image/webp", ext: "webp", ...webpSize(data) };
  }
  return null;
}

// MP4 and QuickTime start with an "ftyp" box; WebM starts with the EBML magic number.
export function sniffVideo(data: Buffer): Sniffed | null {
  if (data.length >= 12 && data.toString("ascii", 4, 8) === "ftyp") {
    const brand = data.toString("ascii", 8, 12);
    if (brand === "qt  ") return { kind: "video", mime: "video/quicktime", ext: "mov", width: null, height: null };
    return { kind: "video", mime: "video/mp4", ext: "mp4", width: null, height: null };
  }
  if (data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return { kind: "video", mime: "video/webm", ext: "webm", width: null, height: null };
  }
  return null;
}

function jpegSize(data: Buffer): { width: number | null; height: number | null } {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) return { width: null, height: null };
    const marker = data[offset + 1]!;
    const length = data.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  return { width: null, height: null };
}

function webpSize(data: Buffer): { width: number | null; height: number | null } {
  const chunk = data.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
  if (chunk === "VP8 " && data.length >= 30) return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L" && data.length >= 25) {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { width: null, height: null };
}

// Product media is a list of photos and short videos. Records saved before videos
// existed have no `kind`; they are photos.
export type ImageRec = {
  id: string;
  kind?: MediaKind;
  role: ImageRole;
  alt: string;
  fileName: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
  originalName: string;
  isRealPhoto: boolean;
  approved: boolean;
  sortOrder: number;
  createdAt: string;
};

export const mediaKind = (image: Pick<ImageRec, "kind">): MediaKind => image.kind ?? "image";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type UploadInput = {
  data: Buffer;
  originalName: string;
  role: ImageRole;
  alt: string;
  isRealPhoto: boolean;
};

// Validates and writes the file to Cloud Storage. The caller records the returned
// metadata on the owning document; on failure there it should call deleteImageFile.
// `allowVideo` is false for places that only take photos (the editorial library).
export async function uploadImage(
  bucket: Bucket,
  input: UploadInput,
  sortOrder: number,
  limits: { maxImageBytes: number; maxVideoBytes: number; allowVideo: boolean } = {
    maxImageBytes: MAX_IMAGE_BYTES,
    maxVideoBytes: MAX_IMAGE_BYTES,
    allowVideo: false,
  },
): Promise<ImageRec> {
  const sniffed = sniffImage(input.data) ?? (limits.allowVideo ? sniffVideo(input.data) : null);
  if (!sniffed) {
    throw new ApiError(
      415,
      "unsupported_media",
      limits.allowVideo ? "Upload a JPEG, PNG or WebP photo, or an MP4, MOV or WebM video." : "Upload a JPEG, PNG or WebP image.",
    );
  }
  if (sniffed.kind === "image") {
    if (input.data.length > limits.maxImageBytes) {
      throw new ApiError(413, "file_too_large", `Photos must be under ${Math.round(limits.maxImageBytes / 1024 / 1024)} MB.`);
    }
    if (sniffed.width !== null && sniffed.height !== null && (sniffed.width < 400 || sniffed.height < 400)) {
      throw new ApiError(422, "image_too_small", "Product photos must be at least 400 × 400 pixels.");
    }
  } else if (input.data.length > limits.maxVideoBytes) {
    throw new ApiError(413, "file_too_large", `Videos must be under ${Math.round(limits.maxVideoBytes / 1024 / 1024)} MB.`);
  }
  const id = newId();
  const fileName = `${id}.${sniffed.ext}`;
  await bucket.file(objectPath(fileName)).save(input.data, {
    resumable: false,
    contentType: sniffed.mime,
    metadata: { cacheControl: "private, max-age=0" },
  });
  return {
    id,
    kind: sniffed.kind,
    role: input.role,
    alt: input.alt,
    fileName,
    mime: sniffed.mime,
    bytes: input.data.length,
    width: sniffed.width,
    height: sniffed.height,
    sha256: sha256(input.data),
    originalName: input.originalName.slice(0, 200),
    isRealPhoto: input.isRealPhoto,
    approved: false,
    sortOrder,
    createdAt: now(),
  };
}

export const objectPath = (fileName: string) => `images/${fileName}`;

export async function deleteImageFile(bucket: Bucket, fileName: string) {
  await bucket.file(objectPath(fileName)).delete({ ignoreNotFound: true });
}

export async function readImageFile(bucket: Bucket, fileName: string): Promise<Buffer | null> {
  try {
    const [data] = await bucket.file(objectPath(fileName)).download();
    return data;
  } catch {
    return null;
  }
}

// Streams a stored file, honouring a single Range request so videos can seek and
// start playing before the whole file arrives (Safari requires this).
export async function mediaResponse(bucket: Bucket, fileName: string, range: string | undefined, cacheControl: string, extra: Record<string, string> = {}): Promise<Response | null> {
  const file = bucket.file(objectPath(fileName));
  let size: number;
  try {
    const [metadata] = await file.getMetadata();
    size = Number(metadata.size);
  } catch {
    return null;
  }
  const type = MEDIA_TYPES[fileName.split(".").pop()!] ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Cache-Control": cacheControl,
    "Accept-Ranges": "bytes",
    ...extra,
  };
  let start = 0;
  let end = size - 1;
  let status = 200;
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match && (match[1] || match[2])) {
    if (match[1]) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), size - 1);
    } else {
      start = Math.max(size - Number(match[2]), 0);
    }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  if (size === 0) return new Response(null, { status: 200, headers });
  const stream = Readable.toWeb(file.createReadStream({ start, end })) as unknown as ReadableStream;
  return new Response(stream, { status, headers });
}

export function sortImages(images: ImageRec[]): ImageRec[] {
  // Within a role, photos come before videos so the first public item is always a photo.
  const kindRank = (image: ImageRec) => (mediaKind(image) === "image" ? 0 : 1);
  return [...images].sort((a, b) => roleRank[a.role] - roleRank[b.role] || kindRank(a) - kindRank(b) || a.sortOrder - b.sortOrder);
}

// Checks an image is fit to be approved for public use. Returns problems; empty means OK.
export function approvalProblems(image: Pick<ImageRec, "role" | "alt" | "isRealPhoto">): string[] {
  const problems: string[] = [];
  if (image.alt.trim().length < 8) problems.push("Add descriptive alt text (at least 8 characters).");
  if (PHYSICAL_ROLES.has(image.role) && !image.isRealPhoto) {
    problems.push("Confirm this is a real photograph or video of the Esspor item, not a render or concept image.");
  }
  if (image.role === "source-bottle" && !/source|original|full[- ]size|bottle/i.test(image.alt)) {
    problems.push("Source-bottle alt text must say it shows the original bottle, not the decant.");
  }
  return problems;
}

export const MEDIA_FILE = /^[0-9a-f-]{36}\.(jpg|png|webp|mp4|mov|webm)$/;
export const MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};
