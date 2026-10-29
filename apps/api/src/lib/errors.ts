import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  status: ContentfulStatusCode;
  code: string;
  details?: unknown;

  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = "Resource") =>
  new ApiError(404, "not_found", `${what} was not found.`);

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "invalid_request", message, details);

export const conflict = (code: string, message: string, details?: unknown) =>
  new ApiError(409, code, message, details);
