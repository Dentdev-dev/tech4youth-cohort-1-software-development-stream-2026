import { z } from "zod";

const email = z
  .email("A valid email is required")
  .trim()
  .toLowerCase()
  .max(254);

// At least 8 chars, with upper, lower and a digit.
const password = z
  .string("Password is required")
  .min(8, "Password must be at least 8 characters long")
  .max(72, "Password must be at most 72 characters long") // bcrypt limit
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number");

const name = z
  .string("Name is required")
  .trim()
  .min(2, "Name must be at least 2 characters long")
  .max(100);

export const registerSchema = z.object({ name, email, password });

export const loginSchema = z.object({
  email,
  password: z.string("Password is required").min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string("Token is required").regex(/^[a-f0-9]{64}$/, "Invalid token"),
  password,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string("Current password is required").min(1),
    newPassword: password,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

const optionalText = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();

export const updateProfileSchema = z
  .object({
    name: name.optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9\s-]{7,20}$/, "Invalid phone number")
      .nullable()
      .optional(),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
    city: optionalText(100),
    state: optionalText(100),
    postalCode: optionalText(20),
    country: optionalText(100),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
