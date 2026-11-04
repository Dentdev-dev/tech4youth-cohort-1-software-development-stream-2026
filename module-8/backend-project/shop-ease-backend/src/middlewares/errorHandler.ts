import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError.ts";
import { logger } from "../lib/logger.ts";

type PgError = { code?: string; constraint?: string };

// Postgres error codes we can explain to the client instead of returning 500.
const PG_ERRORS: Record<string, [number, string]> = {
  "23505": [409, "A record with this value already exists"],
  "23503": [400, "Referenced record does not exist"],
  "23514": [400, "A value violates a data constraint"],
  "22P02": [400, "Invalid input format"],
};

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // error we created on purpose
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, message: err.message });
    return;
  }

  // Malformed JSON body / payload too large (thrown by express.json)
  const status = (err as { status?: number; type?: string }).status;
  const type = (err as { type?: string }).type;
  if (type === "entity.parse.failed") {
    res.status(400).json({ success: false, message: "Malformed JSON body" });
    return;
  }
  if (type === "entity.too.large" || status === 413) {
    res.status(413).json({ success: false, message: "Request body too large" });
    return;
  }

  const pgCode = (err as PgError).code;
  const mapped = pgCode ? PG_ERRORS[pgCode] : undefined;
  if (mapped) {
    res.status(mapped[0]).json({ success: false, message: mapped[1] });
    return;
  }

  logger.error({ err }, "unhandled error");

  res.status(500).json({ success: false, message: "Internal server error" });
}
