import { createAccessControl } from "better-auth/plugins";

export const appAc = createAccessControl({
  approval: ["write"],
  approvalRequest: ["read", "write"],
  kycDocument: ["read", "write"],
  kycDocumentType: ["read", "write"],
  profile: ["read", "update"],
  providerSearch: ["read", "reindex"],
  serviceCatalogue: ["read", "write"],
  serviceOffered: ["read", "write"],
});

export const familyRole = appAc.newRole({
  profile: ["read", "update"],
  providerSearch: ["read"],
  approvalRequest: ["write"],
  kycDocument: ["write"],
  serviceCatalogue: ["read"],
  serviceOffered: ["read", "write"],
});

export const spRole = appAc.newRole({
  profile: ["read", "update"],
  approvalRequest: ["write"],
  kycDocument: ["write"],
  serviceCatalogue: ["read"],
  serviceOffered: ["read", "write"],
});

export const adminRole = appAc.newRole({
  approval: ["write"],
  approvalRequest: ["read", "write"],
  kycDocument: ["read", "write"],
  kycDocumentType: ["read", "write"],
  profile: ["read", "update"],
  providerSearch: ["read", "reindex"],
  serviceCatalogue: ["read", "write"],
  serviceOffered: ["read", "write"],
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
