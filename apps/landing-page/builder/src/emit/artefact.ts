import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLASSES } from "../classes";
import { BLOG, BLOG_POSTS, BLOG_STRINGS, blogBody } from "../content/blog";
import { LANGS, type Lang } from "../content/types";
import { assertUniqueIds, collectCss, type El, type Recipe } from "../dsl";
import { MediaRegistry, resolveMedia } from "../media";
import { APP, PAGES, pageUrl, resolveLinks, type PageKey } from "../pages";
import { VARIABLES } from "../tokens";

export type ArtefactManifest = { builderVersion: string; elementorVersion: string; entries: string[]; media: Record<string, { ext: string; alt: string; key: string }> };

const stable = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

function stripInternal(el: El): Record<string, unknown> {
  const { _css, ...rest } = el;
  return { ...rest, elements: el.elements.map(stripInternal) };
}

export async function buildArtefact(opts: { outDir: string; recipes: Recipe[] }): Promise<ArtefactManifest> {
  const { outDir, recipes } = opts;
  rmSync(outDir, { recursive: true, force: true });
  for (const d of ["media", "pages", "templates", "blog/posts"]) mkdirSync(join(outDir, d), { recursive: true });
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

  writeBlog(write, outDir);

  const mediaIndex: ArtefactManifest["media"] = {};
  for (const f of media.all().sort((a, b) => a.hash.localeCompare(b.hash))) {
    copyFileSync(f.sourcePath, join(outDir, "media", `${f.hash}.${f.ext}`));
    mediaIndex[f.hash] = { ext: f.ext, alt: f.alt, key: f.key };
  }
  writeFileSync(join(outDir, "variables.json"), stable(VARIABLES));
  writeFileSync(join(outDir, "classes.json"), stable(Object.values(CLASSES).map((c) => ({ id: c.id, label: c.label, css: c.css }))));
  const manifest: ArtefactManifest = { builderVersion: "1", elementorVersion: "4.2.4", entries: entries.sort(), media: mediaIndex };
  writeFileSync(join(outDir, "manifest.json"), stable(manifest));
  return manifest;
}

/**
 * `{{page:<key>}}` and `{{app:<key>}}` placeholders inside blog copy, resolved the same way
 * `resolveLinks()` resolves an element's `page:<key>` destination. `{{post:<key>}}` is deliberately
 * left alone: a post's permalink is only known once WordPress has created the post, so
 * `server/import.php` substitutes those after the posts exist.
 */
export function resolveBlogLinks(html: string, lang: Lang): string {
  return html.replace(/\{\{(page|app):([a-zA-Z-]+)\}\}/g, (whole, kind: string, key: string) => {
    if (kind === "app") {
      const url = (APP as Record<string, string>)[key];
      if (!url) throw new Error(`resolveBlogLinks(): unknown app link "${key}"`);
      return url;
    }
    if (!PAGES[key as PageKey]) throw new Error(`resolveBlogLinks(): unknown page key "${key}"`);
    return pageUrl(key as PageKey, lang);
  });
}

/**
 * The blog's slice of the artefact. Not Elementor: `blog/strings.<lang>.json` carries the index
 * and article chrome plus the blog page itself, and `blog/posts/<key>.<lang>.json` one post each.
 */
function writeBlog(write: (rel: string, body: unknown) => void, _outDir: string): void {
  for (const lang of LANGS) {
    write(`blog/strings.${lang}.json`, {
      lang,
      page: { key: "blog", slug: PAGES.blog.slug[lang], title: PAGES.blog.title[lang] },
      ...BLOG_STRINGS[lang],
      sideCards: Object.fromEntries(
        Object.entries(BLOG_STRINGS[lang].sideCards).map(([k, v]) => [k, { ...v, href: APP.signUp }]),
      ),
      order: [...BLOG_POSTS],
    });
    for (const key of BLOG_POSTS) {
      const post = BLOG[lang][key];
      write(`blog/posts/${key}.${lang}.json`, {
        key,
        lang,
        ...post,
        lead: resolveBlogLinks(post.lead, lang),
        body: resolveBlogLinks(blogBody(key, lang), lang),
      });
    }
  }
}
