// Photos are shrunk in the browser before upload. A phone photo is often 4–8 MB; after
// this it is a few hundred KB, which is plenty for a product page and is what the
// storefront will serve to every visitor (served bytes are billed, so this matters).
const MAX_EDGE = 1800;
const LEAVE_ALONE_BELOW = 500 * 1024;
const QUALITY = 0.82;

export type PreparedFile = { file: File; savedBytes: number };

export async function preparePhoto(file: File): Promise<PreparedFile> {
  const untouched = { file, savedBytes: 0 };
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return untouched;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    // Never scale up: the server wants at least 400 px, and small originals stay as they are.
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= LEAVE_ALONE_BELOW) {
      bitmap.close();
      return untouched;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return untouched;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", QUALITY));
    // Keep the original if the browser can't write WebP or the result isn't smaller.
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return untouched;
    const name = `${file.name.replace(/\.[^.]+$/, "") || "photo"}.webp`;
    return { file: new File([blob], name, { type: "image/webp" }), savedBytes: file.size - blob.size };
  } catch {
    return untouched;
  }
}
