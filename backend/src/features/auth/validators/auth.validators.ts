import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().trim().max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    // bcrypt operates on bytes and silently truncates past 72 bytes, so the
    // limit is enforced on UTF-8 byte length rather than character count.
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= 72,
      "Password must be at most 72 bytes"
    )
    .regex(/[a-zA-Z]/, "Password must contain at least one letter")
    .regex(/[0-9]/, "Password must contain at least one digit"),
});

export const loginSchema = z.object({
  email: z.email().trim().max(254),
  password: z.string().min(1).max(72),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).max(4096),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
