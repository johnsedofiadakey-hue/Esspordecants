import type { Context } from "hono";
import { z } from "zod";
import { badRequest } from "./errors.ts";

export async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  return parse(schema, body);
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      "Some fields are invalid.",
      result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return result.data;
}

export const shortText = (max = 200) => z.string().trim().max(max);
export const longText = (max = 8000) => z.string().trim().max(max);
export const noteList = z.array(z.string().trim().min(1).max(60)).max(20);
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.");
