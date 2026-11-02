import type { MiddlewareHandler } from "hono";
import { ApiError } from "./errors.ts";

// A small fixed-window limiter, per function instance. It is not a substitute for a
// bot challenge, but it stops one client from hammering the order and tracking
// routes (each request costs function time and Firestore reads).
export function rateLimit(perMinute: number): MiddlewareHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    if (perMinute <= 0) return next();
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    const key = c.req.header("fastly-client-ip") ?? forwarded ?? "unknown";
    const nowMs = Date.now();
    if (hits.size > 5000) for (const [entry, value] of hits) if (value.resetAt < nowMs) hits.delete(entry);
    const hit = hits.get(key);
    if (!hit || hit.resetAt < nowMs) hits.set(key, { count: 1, resetAt: nowMs + 60_000 });
    else if (++hit.count > perMinute) {
      c.header("Retry-After", String(Math.ceil((hit.resetAt - nowMs) / 1000)));
      throw new ApiError(429, "rate_limited", "Too many requests. Please wait a minute and try again.");
    }
    return next();
  };
}
