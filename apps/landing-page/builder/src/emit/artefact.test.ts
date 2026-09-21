import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { footerRecipe } from "../recipes/footer";
import { headerRecipe } from "../recipes/header";
import { homeRecipe } from "../recipes/home";
import { buildArtefact } from "./artefact";

const strip = (dir: string) => {
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  delete m.builtAt;
  return JSON.stringify(m) + readdirSync(dir, { recursive: true }).sort().join("\n") +
    readFileSync(join(dir, "pages/home.en.json"), "utf8") + readFileSync(join(dir, "templates/header.fr.json"), "utf8");
};

describe("artefact", () => {
  test("writes every entry and is deterministic", async () => {
    const a = mkdtempSync(join(tmpdir(), "art-a-")), b = mkdtempSync(join(tmpdir(), "art-b-"));
    const m = await buildArtefact({ outDir: a, recipes: [headerRecipe, footerRecipe, homeRecipe] });
    await buildArtefact({ outDir: b, recipes: [headerRecipe, footerRecipe, homeRecipe] });
    expect(m.entries.sort()).toEqual(["pages/home.en.json", "pages/home.fr.json", "templates/footer.en.json", "templates/footer.fr.json", "templates/header.en.json", "templates/header.fr.json"]);
    expect(strip(a)).toBe(strip(b));
  });
  test("home page has resolved links and hashed media, and _css covers every local style", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    await buildArtefact({ outDir: dir, recipes: [homeRecipe] });
    const page = JSON.parse(readFileSync(join(dir, "pages/home.fr.json"), "utf8"));
    const s = JSON.stringify(page.elements);
    expect(s).not.toContain('"page:');
    expect(s).toContain('"/fr/securite-et-confiance"');
    expect(s).not.toMatch(/"media-hash","value":"(icon|media):/);
    const styleIds = [...s.matchAll(/"e-[0-9a-f]{7}-[0-9a-f]{7}"/g)].map((x) => x[0].replace(/"/g, ""));
    for (const id of new Set(styleIds)) expect(page._css[id]).toBeDefined();
    expect(readdirSync(join(dir, "media")).length).toBeGreaterThan(10);
  });
});
