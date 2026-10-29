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

type Sniffed = { mime: string; ext: string; width: number | null; height: number | null };

export function sniffImage(data: Buffer): Sniffed | null {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg", ...jpegSize(data) };
  }
  if (data.length >= 30 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp", ...webpSize(data) };
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

export type ImageRec = {
  id: string;
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

export type UploadInput = {
  data: Buffer;
  originalName: string;
  role: ImageRole;
  alt: string;
  isRealPhoto: boolean;
};

// Validates and writes the file to Cloud Storage. The caller records the returned
// metadata on the owning document; on failure there it should call deleteImageFile.
export async function uploadImage(bucket: Bucket, input: UploadInput, sortOrder: number): Promise<ImageRec> {
  const sniffed = sniffImage(input.data);
  if (!sniffed) {
    throw new ApiError(415, "unsupported_image", "Upload a JPEG, PNG or WebP image.");
  }
  if (sniffed.width !== null && sniffed.height !== null && (sniffed.width < 400 || sniffed.height < 400)) {
    throw new ApiError(422, "image_too_small", "Product photos must be at least 400 × 400 pixels.");
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

export function sortImages(images: ImageRec[]): ImageRec[] {
  return [...images].sort((a, b) => roleRank[a.role] - roleRank[b.role] || a.sortOrder - b.sortOrder);
}

// Checks an image is fit to be approved for public use. Returns problems; empty means OK.
export function approvalProblems(image: Pick<ImageRec, "role" | "alt" | "isRealPhoto">): string[] {
  const problems: string[] = [];
  if (image.alt.trim().length < 8) problems.push("Add descriptive alt text (at least 8 characters).");
  if (PHYSICAL_ROLES.has(image.role) && !image.isRealPhoto) {
    problems.push("Confirm this is a real photograph of the Esspor item, not a render or concept image.");
  }
  if (image.role === "source-bottle" && !/source|original|full[- ]size|bottle/i.test(image.alt)) {
    problems.push("Source-bottle alt text must say it shows the original bottle, not the decant.");
  }
  return problems;
}

export const MEDIA_FILE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
export const MEDIA_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
