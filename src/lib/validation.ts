import { z } from "zod";

export const emailSchema = z.string().trim().email().max(160);
export const phoneSchema = z.string().trim().min(7).max(20).regex(/^[0-9+\-\s()]+$/, "Enter a valid phone number");
export const nameSchema = z.string().trim().min(2).max(120);
export const addressSchema = z.string().trim().min(5).max(500);
export const passwordSchema = z.string().min(10, "Password must be at least 10 characters").max(128);
export const positiveInt = z.coerce.number().int().positive();
export const nonNegativeInt = z.coerce.number().int().nonnegative();
export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(90)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens");

export function zodErrors(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}
