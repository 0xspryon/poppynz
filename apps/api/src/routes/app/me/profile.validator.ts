import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const profileUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1).nullable().optional(),
    lastName: z.string().trim().min(1).nullable().optional(),
    gender: z.enum(["male", "female"]).nullable().optional(),
    phoneNumber: z.string().trim().min(1).nullable().optional(),
    dateOfBirth: z.string().trim().min(1).nullable().optional(),
    address: z.string().trim().min(1).nullable().optional(),
    city: z.string().trim().min(1).nullable().optional(),
    postalCode: z.string().trim().min(1).nullable().optional(),
    country: z.string().trim().min(1).nullable().optional(),
    stateProvince: z.string().trim().min(1).nullable().optional(),
    shortBio: z.string().trim().nullable().optional(),
  })
  .strict();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const profileUpdateValidator = zValidator("json", profileUpdateSchema, (result, c) => {
  if (!result.success) {
    return c.json(
      {
        error: {
          code: "INVALID_PROFILE_INPUT" as const,
          message: "Profile update contains invalid or unsupported fields.",
          issues: result.error.issues,
        },
      },
      400,
    );
  }
});
