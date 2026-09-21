import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLASSES } from "../classes";
import { LANGS, type Lang } from "../content/types";
import { assertUniqueIds, collectCss, type El, type Recipe } from "../dsl";
import { MediaRegistry, resolveMedia } from "../media";
import { PAGES, resolveLinks, type PageKey } from "../pages";
import { VARIABLES } from "../tokens";

export type ArtefactManifest = { builderVersion: string; elementorVersion: string; builtAt: string; entries: string[]; media: Record<string, { ext: string; alt: string; key: string }> };

const stable = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

function stripInternal(el: El): Record<string, unknown> {
  const { _css, ...rest } = el;
  return { ...rest, elements: el.elements.map(stripInternal) };
}

export async function buildArtefact(opts: { outDir: string; recipes: Recipe[] }): Promise<ArtefactManifest> {
  const { outDir, recipes } = opts;
  rmSync(outDir, { recursive: true, force: true });
  for (const d of ["media", "pages", "templates"]) mkdirSync(join(outDir, d), { recursive: true });
  const media = new MediaRegistry();
  const entries: string[] = [];

  const write = (rel: string, body: unknown) => { writeFileSync(join(outDir, rel), stable(body)); entries.push(rel); };

  for (const r of recipes) {
    for (const lang of LANGS) {
      const built = r.build(lang, media);
      assertUniqueIds(built);
      const resolved = built.map((el) => resolveMedia(resolveLinks(el, lang), media));
      const _css = Object.assign({}, ...resolved.map(collectCss));
      const elements = resolved.map(stripInternal);
      if (r.kind === "page") {
        const key = r.key as PageKey;
        write(`pages/${key}.${lang}.json`, { key, lang, slug: PAGES[key].slug[lang], title: PAGES[key].title[lang], elements, _css });
      } else {
        const title = `Site ${r.kind} (${lang})`;
        write(`templates/${r.kind}.${lang}.json`, { title, type: r.kind === "header" ? "type_header" : "type_footer", lang, elements, _css });
      }
    }
  }

  const mediaIndex: ArtefactManifest["media"] = {};
  for (const f of media.all().sort((a, b) => a.hash.localeCompare(b.hash))) {
    copyFileSync(f.sourcePath, join(outDir, "media", `${f.hash}.${f.ext}`));
    mediaIndex[f.hash] = { ext: f.ext, alt: f.alt, key: f.key };
  }
  writeFileSync(join(outDir, "variables.json"), stable(VARIABLES));
  writeFileSync(join(outDir, "classes.json"), stable(Object.values(CLASSES).map((c) => ({ id: c.id, label: c.label, css: c.css }))));
  const manifest: ArtefactManifest = { builderVersion: "1", elementorVersion: "4.2.4", builtAt: new Date().toISOString(), entries: entries.sort(), media: mediaIndex };
  writeFileSync(join(outDir, "manifest.json"), stable(manifest));
  return manifest;
}
