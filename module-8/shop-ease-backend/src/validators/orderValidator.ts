import { z } from "zod";
import { ORDER_STATUSES } from "../types/order.ts";
import { paginationSchema } from "./common.ts";

export const shippingAddressSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{7,20}$/, "Invalid phone number"),
  addressLine1: z.string().trim().min(3).max(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().min(2).max(100),
});

export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.uuid("Invalid product id"),
        quantity: z.number().int().min(1).max(100),
      }),
    )
    .min(1, "Order must contain at least one item")
    .max(50, "An order can contain at most 50 different items")
    .refine(
      (items) => new Set(items.map((i) => i.productId)).size === items.length,
      { message: "Each product may only appear once; adjust quantity instead" },
    ),
  // Optional: falls back to the address saved on the customer profile.
  shippingAddress: shippingAddressSchema.optional(),
  notes: z.string().trim().max(500).optional(),
});

export const orderQuerySchema = paginationSchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderQuery = z.infer<typeof orderQuerySchema>;
