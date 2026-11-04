import type { Request, Response, NextFunction } from "express";
import { FilterXSS } from "xss";

// Strip ALL HTML tags from user input; we never accept markup.
const filter = new FilterXSS({
  whiteList: {},
  stripIgnoreTag: true,
  stripIgnoreTagBody: ["script", "style"],
});

// Secrets are hashed/compared, never rendered — sanitising would silently change them.
const SKIP_KEYS = /password|token/i;

function clean(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    return SKIP_KEYS.test(key) ? value : filter.process(value);
  }
  if (Array.isArray(value)) return value.map((v) => clean(v, key));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // Drop prototype-pollution keys.
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      out[k] = clean(v, k);
    }
    return out;
  }
  return value;
}

/** Removes HTML/script from request bodies to prevent stored XSS. */
export function sanitizeInput(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.body && typeof req.body === "object") {
    req.body = clean(req.body);
  }
  next();
}
