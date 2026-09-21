import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { El } from "./dsl";

export type MediaFile = { key: string; hash: string; ext: string; sourcePath: string; alt: string };

const HERE = import.meta.dir; // apps/landing-page/builder/src

export class MediaRegistry {
  private files = new Map<string, MediaFile>();

  add(key: string, sourcePath: string, alt = ""): MediaFile {
    const abs = resolve(HERE, sourcePath);
    if (!existsSync(abs)) throw new Error(`media "${key}": file not found ${abs}`);
    const hash = createHash("sha1").update(readFileSync(abs)).digest("hex").slice(0, 12);
    const f: MediaFile = { key, hash, ext: extname(abs).slice(1).toLowerCase(), sourcePath: abs, alt };
    this.files.set(key, f);
    return f;
  }

  icon(name: string): MediaFile {
    const key = `icon:${name}`;
    const existing = this.files.get(key);
    if (existing) return existing;
    const dir = resolve(HERE, "../node_modules/line-awesome/svg");
    for (const candidate of [`${name}-solid.svg`, `${name}.svg`]) {
      if (existsSync(resolve(dir, candidate))) return this.add(key, resolve(dir, candidate), "");
    }
    throw new Error(`icon "${name}" not found in line-awesome (tried ${name}-solid.svg, ${name}.svg)`);
  }

  get(key: string): MediaFile {
    const f = this.files.get(key);
    if (!f) throw new Error(`media key "${key}" is not registered`);
    return f;
  }

  all(): MediaFile[] { return [...this.files.values()]; }
}

export function resolveMedia(el: El, reg: MediaRegistry): El {
  const out = structuredClone(el);
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      if (o.$$type === "media-hash" && typeof o.value === "string" && !/^[0-9a-f]{12}$/.test(o.value)) o.value = reg.get(o.value).hash;
      Object.values(o).forEach(walk);
    }
  };
  walk(out);
  return out;
}
