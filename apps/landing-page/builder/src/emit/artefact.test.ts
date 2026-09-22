import { describe, expect, test } from "bun:test";
import { BLOG, BLOG_POSTS } from "../content/blog";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { footerRecipe } from "../recipes/footer";
import { headerRecipe } from "../recipes/header";
import { homeRecipe } from "../recipes/home";
import { buildArtefact } from "./artefact";

const strip = (dir: string) =>
  readFileSync(join(dir, "manifest.json"), "utf8") + readdirSync(dir, { recursive: true }).sort().join("\n") +
    readFileSync(join(dir, "pages/home.en.json"), "utf8") + readFileSync(join(dir, "templates/header.fr.json"), "utf8");

// Recursively finds an element by widgetType anywhere under `elements`.
function findByWidgetType(elements: any[], widgetType: string): any {
  for (const el of elements) {
    if (el.widgetType === widgetType) return el;
    const found = findByWidgetType(el.elements ?? [], widgetType);
    if (found) return found;
  }
  return undefined;
}

// Finds the card whose editor_settings.title is `cardTitle`, then returns the alt
// text of the "Illustration" e-image widget nested inside it.
function findCardImageAlt(elements: any[], cardTitle: string): string | undefined {
  for (const el of elements) {
    if (el.editor_settings?.title === cardTitle) {
      const img = findByWidgetType(el.elements ?? [], "e-image");
      return img?.settings.image.value.src.value.alt.value;
    }
    const found = findCardImageAlt(el.elements ?? [], cardTitle);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe("artefact", () => {
  test("writes every entry and is deterministic", async () => {
    const a = mkdtempSync(join(tmpdir(), "art-a-")), b = mkdtempSync(join(tmpdir(), "art-b-"));
    const m = await buildArtefact({ outDir: a, recipes: [headerRecipe, footerRecipe, homeRecipe] });
    await buildArtefact({ outDir: b, recipes: [headerRecipe, footerRecipe, homeRecipe] });
    // The blog is not a recipe (spec § 8: native posts, not an Elementor document), so it is
    // written on every build regardless of which recipes are passed; assert it separately.
    expect(m.entries.filter((e) => !e.startsWith("blog/")).sort()).toEqual(["pages/home.en.json", "pages/home.fr.json", "templates/footer.en.json", "templates/footer.fr.json", "templates/header.en.json", "templates/header.fr.json"]);
    expect(m.entries.filter((e) => e.startsWith("blog/"))).toHaveLength(2 + 2 * BLOG_POSTS.length);
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
  test("service card images carry per-language alt text, not the manifest's clobbered alt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    await buildArtefact({ outDir: dir, recipes: [homeRecipe] });
    const fr = JSON.parse(readFileSync(join(dir, "pages/home.fr.json"), "utf8"));
    const en = JSON.parse(readFileSync(join(dir, "pages/home.en.json"), "utf8"));
    expect(findCardImageAlt(fr.elements, "Garde d’enfants")).toBe("Garde d’enfants");
    expect(findCardImageAlt(en.elements, "Childcare")).toBe("Childcare");
  });

  test("the blog is written for both languages with resolved page links and unresolved post links", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    await buildArtefact({ outDir: dir, recipes: [] });
    for (const lang of ["en", "fr"] as const) {
      const strings = JSON.parse(readFileSync(join(dir, `blog/strings.${lang}.json`), "utf8"));
      expect(strings.page.slug).toBe(lang === "en" ? "blog" : "blogue");
      expect(strings.order).toEqual([...BLOG_POSTS]);
      expect(strings.sideCards.families.href).toBe("/app/auth/sign-up");
      expect(strings.months).toHaveLength(12);
      for (const key of BLOG_POSTS) {
        const post = JSON.parse(readFileSync(join(dir, `blog/posts/${key}.${lang}.json`), "utf8"));
        expect(post.key).toBe(key);
        expect(post.slug).toBe(BLOG[lang][key].slug);
        expect(post.body.length).toBeGreaterThan(500);
        expect(post.body).not.toContain("{{page:");
        expect(post.body).not.toContain("{{app:");
        expect(post.related.every((r: string) => (BLOG_POSTS as readonly string[]).includes(r))).toBe(true);
      }
    }
    // Page links resolve per language; post links stay for server/import.php to substitute.
    const en = JSON.parse(readFileSync(join(dir, "blog/posts/vulnerable-sector-check.en.json"), "utf8"));
    const fr = JSON.parse(readFileSync(join(dir, "blog/posts/vulnerable-sector-check.fr.json"), "utf8"));
    expect(en.body).toContain('href="/safety-and-trust"');
    expect(fr.body).toContain('href="/fr/securite-et-confiance"');
    expect(JSON.parse(readFileSync(join(dir, "blog/posts/reading-a-helper-profile.en.json"), "utf8")).body)
      .toContain("{{post:vulnerable-sector-check}}");
  });

  test("every article's headings carry the same ids in both languages, so one TOC shape serves both", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    await buildArtefact({ outDir: dir, recipes: [] });
    const ids = (body: string) => [...body.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
    for (const key of BLOG_POSTS) {
      const en = JSON.parse(readFileSync(join(dir, `blog/posts/${key}.en.json`), "utf8"));
      const fr = JSON.parse(readFileSync(join(dir, `blog/posts/${key}.fr.json`), "utf8"));
      expect(ids(fr.body)).toEqual(ids(en.body));
    }
  });
});
