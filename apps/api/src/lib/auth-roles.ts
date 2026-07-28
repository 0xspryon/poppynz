import { createAccessControl } from "better-auth/plugins";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

export const appAc = createAccessControl({
  // better-auth admin plugin resources (user, session) — required so its
  // endpoints (list/ban/impersonate) can authorize against our custom roles.
  ...defaultStatements,
  approval: ["write"],
  approvalRequest: ["read", "write"],
  kycDocument: ["read", "write"],
  kycDocumentType: ["read", "write"],
  profile: ["read", "update"],
  providerSearch: ["read", "reindex"],
  referral: ["read", "write"],
  serviceCatalogue: ["read", "write"],
  serviceOffered: ["read", "write"],
  tcs: ["read", "accept", "write"],
});

export const familyRole = appAc.newRole({
  profile: ["read", "update"],
  providerSearch: ["read"],
  approvalRequest: ["write"],
  kycDocument: ["write"],
  referral: ["read", "write"],
  serviceCatalogue: ["read"],
  serviceOffered: ["read", "write"],
  tcs: ["read", "accept"],
});

export const spRole = appAc.newRole({
  profile: ["read", "update"],
  approvalRequest: ["write"],
  kycDocument: ["write"],
  referral: ["read", "write"],
  serviceCatalogue: ["read"],
  serviceOffered: ["read", "write"],
  tcs: ["read", "accept"],
});

export const adminRole = appAc.newRole({
  // Grants the admin plugin's own admin permissions (user ban/list/impersonate,
  // session management) — deliberately without "impersonate-admins".
  ...adminAc.statements,
  approval: ["write"],
  approvalRequest: ["read", "write"],
  kycDocument: ["read", "write"],
  kycDocumentType: ["read", "write"],
  profile: ["read", "update"],
  providerSearch: ["read", "reindex"],
  referral: ["read", "write"],
  serviceCatalogue: ["read", "write"],
  serviceOffered: ["read", "write"],
  tcs: ["read", "accept", "write"],
});

export const roles = {
  admin: adminRole,
  family: familyRole,
  "service-provider": spRole,
};

export type Role = keyof typeof roles;
export type Roles = Role;

export const isSupportedRole = (input: string): input is Role =>
  Object.prototype.hasOwnProperty.call(roles, input);
