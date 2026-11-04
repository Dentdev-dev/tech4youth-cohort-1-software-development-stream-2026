import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.ts";
import { AppError } from "../errors/AppError.ts";
import { eventBus } from "../events/eventBus.ts";
import { withTransaction } from "../lib/db.ts";
import { signAccessToken } from "../lib/jwt.ts";
import * as userRepo from "../repository/user.repository.ts";
import type { User, UserAuthRecord } from "../types/user.ts";
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateProfileInput,
} from "../validators/authValidator.ts";

const BCRYPT_ROUNDS = 12;
// Used when the email doesn't exist so login takes the same time either way (no user enumeration).
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", BCRYPT_ROUNDS);

export type AuthResult = { user: User; accessToken: string };

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function issueToken(record: UserAuthRecord): string {
  return signAccessToken({
    userId: record.id,
    email: record.email,
    role: record.role,
    tokenVersion: record.tokenVersion,
  });
}

async function loadUser(id: string): Promise<User> {
  const user = await userRepo.findUserById(id);
  if (!user) throw new AppError(404, "User not found");
  return user;
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const existing = await userRepo.findUserByEmail(input.email);
  if (existing) throw new AppError(409, "An account with this email already exists");

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await withTransaction((client) =>
    userRepo.createCustomerUser(client, {
      name: input.name,
      email: input.email,
      passwordHash,
    }),
  );

  eventBus.emit("user.registered", { name: user.name, email: user.email });

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: 0,
  });
  return { user, accessToken };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const record = await userRepo.findAuthRecordByEmail(input.email);
  const valid = await bcrypt.compare(
    input.password,
    record?.passwordHash ?? DUMMY_HASH,
  );
  if (!record || !valid) throw new AppError(401, "Invalid email or password");

  await userRepo.markLogin(record.id);
  return { user: await loadUser(record.id), accessToken: issueToken(record) };
}

/** Logs out every session for this user by invalidating all issued tokens. */
export async function logout(userId: string): Promise<void> {
  await userRepo.incrementTokenVersion(userId);
}

export async function getProfile(userId: string): Promise<User> {
  return loadUser(userId);
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<User> {
  await withTransaction((client) =>
    userRepo.updateProfile(client, userId, input),
  );
  return loadUser(userId);
}

/** Always resolves the same way whether or not the email exists (no user enumeration). */
export async function forgotPassword(email: string): Promise<void> {
  const user = await userRepo.findUserByEmail(email);
  if (!user) return;

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + env.passwordResetExpiresMinutes * 60_000,
  );
  // Only the hash is stored, so a DB leak doesn't expose usable reset links.
  await userRepo.setPasswordResetToken(user.id, hashToken(token), expiresAt);

  const resetUrl = `${env.clientUrl.replace(/\/$/, "")}/reset-password?token=${token}`;
  eventBus.emit("password.resetRequested", {
    name: user.name,
    email: user.email,
    resetUrl,
    expiresInMinutes: env.passwordResetExpiresMinutes,
  });
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const userId = await userRepo.findUserIdByValidResetToken(
    hashToken(input.token),
  );
  if (!userId) throw new AppError(400, "Reset link is invalid or has expired");

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  // Also clears the reset token (single use) and revokes existing sessions.
  const record = await userRepo.updatePassword(userId, passwordHash);

  eventBus.emit("password.changed", { name: record.name, email: record.email });
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
): Promise<{ accessToken: string }> {
  const record = await userRepo.findAuthRecordById(userId);
  if (!record) throw new AppError(404, "User not found");

  const valid = await bcrypt.compare(input.currentPassword, record.passwordHash);
  if (!valid) throw new AppError(401, "Current password is incorrect");

  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  const updated = await userRepo.updatePassword(userId, passwordHash);

  eventBus.emit("password.changed", { name: updated.name, email: updated.email });

  // Old tokens are now invalid; hand back a fresh one so this client stays signed in.
  return { accessToken: issueToken(updated) };
}
