import { ipKeyGenerator, rateLimit } from "express-rate-limit";

const handlerMessage = (message: string) => ({ success: false, message });

/** Baseline limit for the whole API. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: handlerMessage("Too many requests, please try again later"),
});

/** Brute-force protection for login: 5 failed attempts per 15 minutes per IP + email. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req, _res) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "";
    // ipKeyGenerator normalises IPv6 addresses to a /56 subnet.
    return `${ipKeyGenerator(req.ip ?? "")}:${email}`;
  },
  message: handlerMessage(
    "Too many login attempts. Please try again in 15 minutes",
  ),
});

/** Limits sign-ups and password-reset emails to stop spam/abuse. */
export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: handlerMessage("Too many requests, please try again in an hour"),
});
