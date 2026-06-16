import { createAccessControl } from "better-auth/plugins";

export const appAc = createAccessControl({
  approval: ["create"],
  profile: ["read", "update"],
});

export const profileRole = appAc.newRole({
  profile: ["read", "update"],
});

export const adminRole = appAc.newRole({
  approval: ["create"],
  profile: ["read", "update"],
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
