import { z } from "zod";
import { validRoles } from "../../../../lib/constants";
import { zValidator } from "@hono/zod-validator";

export const signupInputSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  role: z.enum(validRoles),
});

export type SignupInput = z.infer<typeof signupInputSchema>;


export const signupValidator = zValidator("json", signupInputSchema, (result, c) => {
  if (!result.success) {
    return c.json(
      {
        error: {
          code: "INVALID_SIGNUP_INPUT" as const,
          message: "A valid email and role are required.",
        },
      },
      400,
    );
  }
})
