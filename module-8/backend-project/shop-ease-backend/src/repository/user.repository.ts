import type pg from "pg";
import { AppError } from "../errors/AppError.ts";
import { pool } from "../lib/db.ts";
import type { CustomerProfile, Role, User, UserAuthRecord } from "../types/user.ts";

type Queryable = pg.Pool | pg.PoolClient;

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: Date;
  updated_at: Date;
  customer_id: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

type AuthRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  password_hash: string;
  token_version: number;
};

const USER_SELECT = `
  SELECT u.id, u.name, u.email, u.role, u.created_at, u.updated_at,
         c.id AS customer_id, c.phone, c.address_line1, c.address_line2,
         c.city, c.state, c.postal_code, c.country
  FROM users u
  LEFT JOIN customers c ON c.user_id = u.id
`;

function toUser(row: UserRow): User {
  const customer: CustomerProfile | null = row.customer_id
    ? {
        id: row.customer_id,
        phone: row.phone,
        addressLine1: row.address_line1,
        addressLine2: row.address_line2,
        city: row.city,
        state: row.state,
        postalCode: row.postal_code,
        country: row.country,
      }
    : null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customer,
  };
}

function toAuthRecord(row: AuthRow): UserAuthRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    passwordHash: row.password_hash,
    tokenVersion: row.token_version,
  };
}

const AUTH_COLUMNS = "id, name, email, role, password_hash, token_version";

export async function findUserById(
  id: string,
  db: Queryable = pool,
): Promise<User | null> {
  const result = await db.query<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [id]);
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const result = await pool.query<UserRow>(
    `${USER_SELECT} WHERE LOWER(u.email) = LOWER($1)`,
    [email],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

export async function findAuthRecordByEmail(
  email: string,
): Promise<UserAuthRecord | null> {
  const result = await pool.query<AuthRow>(
    `SELECT ${AUTH_COLUMNS} FROM users WHERE LOWER(email) = LOWER($1)`,
    [email],
  );
  const row = result.rows[0];
  return row ? toAuthRecord(row) : null;
}

export async function findAuthRecordById(
  id: string,
): Promise<UserAuthRecord | null> {
  const result = await pool.query<AuthRow>(
    `SELECT ${AUTH_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? toAuthRecord(row) : null;
}

/** Creates a CUSTOMER user and its customer profile in one transaction (pass a tx client). */
export async function createCustomerUser(
  client: pg.PoolClient,
  input: { name: string; email: string; passwordHash: string },
): Promise<User> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [input.name, input.email, input.passwordHash],
  );
  const userId = result.rows[0]?.id;
  if (!userId) throw new AppError(500, "Failed to create user");

  await client.query("INSERT INTO customers (user_id) VALUES ($1)", [userId]);

  const user = await findUserById(userId, client);
  if (!user) throw new AppError(500, "Failed to create user");
  return user;
}

export async function markLogin(userId: string): Promise<void> {
  await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
    userId,
  ]);
}

/** Sets a new password and bumps token_version so every existing JWT is invalidated. */
export async function updatePassword(
  userId: string,
  passwordHash: string,
): Promise<UserAuthRecord> {
  const result = await pool.query<AuthRow>(
    `UPDATE users
     SET password_hash = $1,
         token_version = token_version + 1,
         password_changed_at = NOW(),
         password_reset_token_hash = NULL,
         password_reset_expires_at = NULL,
         updated_at = NOW()
     WHERE id = $2
     RETURNING ${AUTH_COLUMNS}`,
    [passwordHash, userId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "User not found");
  return toAuthRecord(row);
}

export async function incrementTokenVersion(userId: string): Promise<void> {
  await pool.query(
    "UPDATE users SET token_version = token_version + 1 WHERE id = $1",
    [userId],
  );
}

export async function getTokenVersion(userId: string): Promise<number | null> {
  const result = await pool.query<{ token_version: number }>(
    "SELECT token_version FROM users WHERE id = $1",
    [userId],
  );
  return result.rows[0]?.token_version ?? null;
}

export async function setPasswordResetToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await pool.query(
    `UPDATE users
     SET password_reset_token_hash = $1, password_reset_expires_at = $2
     WHERE id = $3`,
    [tokenHash, expiresAt, userId],
  );
}

export async function findUserIdByValidResetToken(
  tokenHash: string,
): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM users
     WHERE password_reset_token_hash = $1
       AND password_reset_expires_at > NOW()`,
    [tokenHash],
  );
  return result.rows[0]?.id ?? null;
}

export type ProfileChanges = {
  name?: string | undefined;
  phone?: string | null | undefined;
  addressLine1?: string | null | undefined;
  addressLine2?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  postalCode?: string | null | undefined;
  country?: string | null | undefined;
};

const CUSTOMER_COLUMNS: Record<Exclude<keyof ProfileChanges, "name">, string> = {
  phone: "phone",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  city: "city",
  state: "state",
  postalCode: "postal_code",
  country: "country",
};

export async function updateProfile(
  client: pg.PoolClient,
  userId: string,
  changes: ProfileChanges,
): Promise<void> {
  if (changes.name !== undefined) {
    await client.query(
      "UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2",
      [changes.name, userId],
    );
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(CUSTOMER_COLUMNS)) {
    const value = changes[key as keyof typeof CUSTOMER_COLUMNS];
    if (value !== undefined) {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (sets.length === 0) return;

  // Upsert so admins (who may have no customer row) can still save contact details.
  values.push(userId);
  const insertCols = sets.map((s) => s.split(" = ")[0]).join(", ");
  const placeholders = values.slice(0, -1).map((_, i) => `$${i + 1}`).join(", ");
  await client.query(
    `INSERT INTO customers (${insertCols}, user_id)
     VALUES (${placeholders}, $${values.length})
     ON CONFLICT (user_id) DO UPDATE SET ${sets.join(", ")}, updated_at = NOW()`,
    values,
  );
}

export async function setUserRole(email: string, role: Role): Promise<boolean> {
  const result = await pool.query(
    "UPDATE users SET role = $1, updated_at = NOW() WHERE LOWER(email) = LOWER($2)",
    [role, email],
  );
  return (result.rowCount ?? 0) > 0;
}
