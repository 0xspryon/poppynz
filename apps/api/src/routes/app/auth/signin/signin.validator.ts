import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import punycode from "ts-punycode";

export const signinInputSchema = z.object({
  email: z
    .string()
    .trim()
    .transform(
      // This is to protect against punycode attacks
      (email) => punycode.toASCII(email.toLowerCase())
    )
    .pipe(z.email())
});

export type SigninInput = z.infer<typeof signinInputSchema>;

export const signinValidator = zValidator("json", signinInputSchema, (result, c) => {
  if (!result.success) {
    return c.json(
      {
        error: {
          code: "INVALID_SIGNIN_INPUT" as const,
          message: "A valid email is required.",
          issues: result.error.issues,
        },
      },
      400,
    );
  }
});
