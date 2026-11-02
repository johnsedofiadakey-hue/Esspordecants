import crypto from "node:crypto";

export const newId = () => crypto.randomUUID();

export const now = () => new Date().toISOString();

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Lowercases and strips accents so "cedre" matches "Cèdre". Also registered as SQL fold().
export function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export const bool = (value: unknown) => value === 1 || value === true;

// Digits only, in international form. A local Ghana number (024 555 0199) becomes
// 233245550199, so the same person typing it two ways is recognised as one.
export function phoneKey(value: string, countryCode = "233"): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return countryCode + digits.slice(1);
  return digits;
}
