import express from "express";
import type { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.ts";
import { notFound } from "./middlewares/notFound.ts";
import { errorHandler } from "./middlewares/errorHandler.ts";
import { requestLogger } from "./middlewares/requestLogger.ts";
import { apiLimiter } from "./middlewares/rateLimit.middleware.ts";
import { sanitizeInput } from "./middlewares/sanitize.middleware.ts";
import { AppError } from "./errors/AppError.ts";
import { apiRouter } from "./routes/index.ts";

export function createApp(): Express {
  const app = express();

  // Needed behind a reverse proxy (Render, Nginx, etc.) so rate limiting sees the real client IP.
  if (env.trustProxy > 0) app.set("trust proxy", env.trustProxy);
  app.disable("x-powered-by");

  // Security headers (CSP, X-Content-Type-Options, frameguard, HSTS, ...)
  app.use(helmet());

  // CORS: only allow configured front-end origins.
  app.use(
    cors({
      origin(origin, callback) {
        // Allow non-browser clients (curl, Postman, server-to-server) with no Origin header.
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new AppError(403, "Origin not allowed by CORS"));
        }
      },
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );

  // Body parsing with size limits (mitigates large-payload DoS)
  app.use(express.json({ limit: "10kb" }));
  app.use(express.urlencoded({ extended: true, limit: "10kb" }));

  // XSS: strip HTML from incoming data
  app.use(sanitizeInput);

  app.use(requestLogger);

  app.use("/api/v1", apiLimiter, apiRouter);

  //error handler
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
