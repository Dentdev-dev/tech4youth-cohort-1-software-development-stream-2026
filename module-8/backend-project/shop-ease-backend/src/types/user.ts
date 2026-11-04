export type Role = "CUSTOMER" | "ADMIN";

export type CustomerProfile = {
  id: string;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

/** Safe, public shape of a user — never includes secrets. */
export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
  customer: CustomerProfile | null;
};

/** Internal row including auth secrets. Never send this to clients. */
export type UserAuthRecord = {
  id: string;
  name: string;
  email: string;
  role: Role;
  passwordHash: string;
  tokenVersion: number;
};

export type TokenPayload = {
  userId: string;
  email: string;
  role: Role;
  tokenVersion: number;
};

export type AuthUser = Omit<TokenPayload, "tokenVersion">;
