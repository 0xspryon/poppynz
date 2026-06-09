import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins"
import { phoneNumber } from "better-auth/plugins"
import { magicLink } from "better-auth/plugins";
import { admin } from "better-auth/plugins"
import { apiKey } from "@better-auth/api-key"
import { organization } from "better-auth/plugins"
import { i18n } from "@better-auth/i18n"
import { openAPI } from "better-auth/plugins"
import { db } from "@repo/db"

export const auth = betterAuth({
  appName: "Poppynz",
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    anonymous(),
    admin(),
    openAPI(),
    apiKey(),
    organization(),
    i18n({
      translations: {
        fr: {
          USER_NOT_FOUND: "Utilisateur non trouvé",
          INVALID_EMAIL_OR_PASSWORD: "Email ou mot de passe invalide",
          INVALID_PASSWORD: "Mot de passe invalide",
        },
        de: {
          USER_NOT_FOUND: "Benutzer nicht gefunden",
          INVALID_EMAIL_OR_PASSWORD: "Ungültige E-Mail oder Passwort",
          INVALID_PASSWORD: "Ungültiges Passwort",
        },
      },
      }),
    phoneNumber({
      sendOTP: ({ phoneNumber, code }, ctx) => {
          // Implement sending OTP code via SMS
      },
      signUpOnVerification: {
        getTempEmail: (phoneNumber) => {
          return `${phoneNumber}@my-site.com`
        },
        //optionally, you can also pass `getTempName` function to generate a temporary name for the user
        getTempName: (phoneNumber) => {
          return phoneNumber //by default, it will use the phone number as the name
        }
      }
    }),
    magicLink({
        sendMagicLink: async ({ email, token, url, metadata }, ctx) => {
            // send email to user
        }
    })
  ],
  database: drizzleAdapter(db, {
      provider: "pg", // or "mysql", "sqlite"
  }),
});
