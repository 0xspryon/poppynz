export const validRoles = ["service-provider", "family"] as const;
export const validApprovalTypes = validRoles
export const validApprovalStatuses = ["approved", "rejected"] as const;
export const validKycDocumentTypes = [
  "government-id",
  "vulnerable-sector-check",
  "first-aid-certification",
  "driving-license",
] as const;
export const validKycDocumentStatuses = ["missing", "uploaded", "approved", "rejected"] as const;
export const validLanguages = ["en", "es"] as const;
export const signupIntentTtlMs = 5 * 60 * 1000;
