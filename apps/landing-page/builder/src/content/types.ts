export type Lang = "en" | "fr";
export const LANGS: Lang[] = ["en", "fr"];
export type Localized<T> = Record<Lang, T>;

function paths(obj: unknown, prefix = ""): string[] {
  if (Array.isArray(obj)) return obj.flatMap((v, i) => paths(v, `${prefix}[${i}]`));
  if (obj && typeof obj === "object") return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
  return [prefix];
}

export function assertLocalizedKeys(obj: Localized<Record<string, unknown>>, where: string): void {
  const en = new Set(paths(obj.en)), fr = new Set(paths(obj.fr));
  const missingFr = [...en].filter((p) => !fr.has(p)), missingEn = [...fr].filter((p) => !en.has(p));
  if (missingFr.length || missingEn.length) {
    throw new Error(`${where}: content keys differ between languages\n  missing in fr: ${missingFr.join(", ") || "-"}\n  missing in en: ${missingEn.join(", ") || "-"}`);
  }
}
