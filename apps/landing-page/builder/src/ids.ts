import { createHash } from "node:crypto";

export function hex7(seed: string): string {
  return createHash("md5").update(seed).digest("hex").slice(0, 7);
}
export function elementId(path: string): string {
  return hex7(`el:${path}`);
}
export function localStyleId(elementId: string): string {
  return `e-${elementId}-${hex7(`${elementId}:style`)}`;
}
export function globalClassId(label: string): string {
  return `g-${hex7(label)}`;
}
