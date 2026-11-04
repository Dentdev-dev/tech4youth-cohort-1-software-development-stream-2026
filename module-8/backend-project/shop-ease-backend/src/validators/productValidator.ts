import { z } from "zod";
import { paginationSchema } from "./common.ts";

// One helper for the "missing vs wrong type" messages
const field = (label: string, type = "a string") => ({
  error: (issue: { input?: unknown }) =>
    issue.input === undefined
      ? `${label} is required`
      : `${label} must be ${type}`,
});

export const productSchema = z.object({
  name: z
    .string(field("Name"))
    .trim()
    .min(2, "Name must be at least 2 characters long"),

  description: z
    .string(field("Description"))
    .trim()
    .min(10, "Description must be at least 10 characters long")
    .max(200, "Description must be at most 200 characters long"),

  price: z
    .number(field("Price", "a valid number"))
    .positive("Price must be greater than 0"),

  stock: z
    .number(field("Stock", "a valid number"))
    .int("Stock must be a whole number")
    .min(0, "Stock cannot be negative"),

  category: z.string(field("Category")).trim().min(1, "Category is required"),

  imageUrl: z.url("Invalid image URL").optional(),
});

export const updateProductSchema = productSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

export const productQuerySchema = paginationSchema.extend({
  search: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
});

export const userIdParamSchema = z.object({
  userId: z.uuid("Invalid user id"),
});

export type ProductInput = z.infer<typeof productSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductQuery = z.infer<typeof productQuerySchema>;
