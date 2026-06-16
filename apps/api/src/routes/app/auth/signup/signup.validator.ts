import { z } from "zod";
import { validRoles } from "@/api/lib/constants";
import { zValidator } from "@hono/zod-validator";
import punycode from 'ts-punycode'

export const signupInputSchema = z.object({
  email: z
    .string()
    .trim()
    .transform(
      // This is to protect against punycode attacks
      (email) => punycode.toASCII(email.toLowerCase())
    )
    .pipe(z.email()),
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
          issues: result.error.issues,
        },
      },
      400,
    );
  }
})
