import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.ts";
import { verifyAccessToken } from "../lib/jwt.ts";
import { getTokenVersion } from "../repository/user.repository.ts";

/**
 * Verifies the Bearer JWT, then checks the user still exists and that the
 * token's version matches the DB. Changing/resetting a password or logging out
 * bumps the version, which revokes every previously issued token.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError(401, "Access token is required");
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const payload = verifyAccessToken(token);

  const currentVersion = await getTokenVersion(payload.userId);
  if (currentVersion === null || currentVersion !== payload.tokenVersion) {
    throw new AppError(401, "Session has expired, please log in again");
  }

  req.user = { userId: payload.userId, email: payload.email, role: payload.role };
  next();
}
