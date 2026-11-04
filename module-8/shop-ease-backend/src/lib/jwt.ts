import type { Role, TokenPayload } from "../types/user.ts";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.ts";
import { AppError } from "../errors/AppError.ts";

type JwtClaims = {
  sub: string;
  email: string;
  role: Role;
  tv: number; // token version
};

export function signAccessToken(payload: TokenPayload): string {
  const options: SignOptions = {
    algorithm: "HS256",
    subject: payload.userId,
    expiresIn: env.jwtAccessExpiresIn as NonNullable<SignOptions["expiresIn"]>,
  };

  return jwt.sign(
    { email: payload.email, role: payload.role, tv: payload.tokenVersion },
    env.jwtAccessSecret,
    options,
  );
}

export function verifyAccessToken(token: string): TokenPayload {
  try {
    const claims = jwt.verify(token, env.jwtAccessSecret, {
      algorithms: ["HS256"],
    }) as JwtClaims;

    return {
      userId: claims.sub,
      email: claims.email,
      role: claims.role,
      tokenVersion: claims.tv,
    };
  } catch {
    throw new AppError(401, "Invalid or expired access token");
  }
}
