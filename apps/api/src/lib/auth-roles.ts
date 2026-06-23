import { createAccessControl } from "better-auth/plugins";

export const appAc = createAccessControl({
  approval: ["write"],
  approvalRequest: ["read", "write"],
  kycDocument: ["read", "write"],
  kycDocumentType: ["read", "write"],
  profile: ["read", "update"],
  serviceOffered: ["read", "write"],
});

export const profileRole = appAc.newRole({
  profile: ["read", "update"],
  approvalRequest: ["write"],
  kycDocument: ["write"],
  serviceOffered: ["read", "write"],
});

export const adminRole = appAc.newRole({
  approval: ["write"],
  approvalRequest: ["read", "write"],
  kycDocument: ["read", "write"],
  kycDocumentType: ["read", "write"],
  profile: ["read", "update"],
  serviceOffered: ["read", "write"],
});

export const roles = {
  admin: adminRole,
  family: profileRole,
  "service-provider": profileRole,
};

export type Role = keyof typeof roles;
export type Roles = Role;

export const isSupportedRole = (input: string): input is Role =>
  Object.prototype.hasOwnProperty.call(roles, input);
