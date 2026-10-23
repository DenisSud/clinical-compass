import { z } from "zod";

export const healthResponse = z.object({
  status: z.literal("ok"),
  db: z.literal("ok"),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponse>;

export const apiError = z.object({
  code: z.string(),
  message: z.string(),
});

export type ApiError = z.infer<typeof apiError>;
