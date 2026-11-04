import { z } from "zod";

export const idParamSchema = z.object({
  id: z.uuid("Invalid id"),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
