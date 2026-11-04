// src/middlewares/requestLogger.ts
import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.ts";

export function requestLogger(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  logger.info(`${req.method} ${req.originalUrl}`);
  next(); // pass to the next step — without this, the request hangs
}
