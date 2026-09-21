import { CLASSES, cls } from "./classes";
import type { Lang } from "./content/types";
import { lintCssMap, normalizeCss, parseCssKey, type CssMap } from "./css";
import { elementId, localStyleId } from "./ids";
import type { MediaRegistry } from "./media";
import { bool, classes as classesProp, html, imageRef, link as linkProp, str, svgRef, videoRef } from "./props";

export type ContainerTag = "div" | "header" | "section" | "article" | "aside" | "footer" | "a" | "button";
export type Interaction = { trigger: "load" | "scrollIn"; effect: "fade" | "slide" | "scale"; direction?: "left" | "right" | "top" | "bottom"; durationMs?: number; delayMs?: number };
export type Common = { title: string; classes?: string[]; css?: CssMap; link?: string; blank?: boolean; interaction?: Interaction };
export type El = {
  id: string; elType: string; widgetType?: string; settings: Record<string, unknown>; styles: Record<string, unknown>;
  elements: El[]; editor_settings: { title: string }; version: "0.0"; interactions?: unknown; _css: Record<string, CssMap>;
};

function size(ms: number) { return { $$type: "size", value: { size: ms, unit: "ms" } }; }

function interactions(id: string, i: Interaction) {
  return {
    items: [{
      $$type: "interaction-item",
      value: {
        interaction_id: str(`temp-${id}`),
        trigger: str(i.trigger),
        animation: {
          $$type: "animation-preset-props",
          value: {
            effect: str(i.effect), type: str("in"), direction: str(i.direction ?? ""),
            timing_config: { $$type: "timing-config", value: { duration: size(i.durationMs ?? 600), delay: size(i.delayMs ?? 0) } },
          },
        },
      },
    }],
    version: 1,
  };
}

function base(path: string, c: Common, elType: string, widgetType?: string): El {
  const id = elementId(path);
  const classList = (c.classes ?? []).map(cls);
  const styles: Record<string, unknown> = {};
  const _css: Record<string, CssMap> = {};
  if (c.css && Object.keys(c.css).length) {
    const problems = lintCssMap(c.css, path);
    if (problems.length) throw new Error(problems.join("\n"));
    const sid = localStyleId(id);
    const normalized: CssMap = Object.fromEntries(Object.entries(c.css).map(([k, v]) => [k, normalizeCss(v ?? "")]));
    styles[sid] = {
      id: sid, type: "class", label: "local",
      variants: Object.keys(normalized).map((k) => { const { breakpoint, state } = parseCssKey(k); return { meta: { breakpoint, state }, props: {} }; }),
    };
    _css[sid] = normalized;
    classList.unshift(sid);
  }
  const settings: Record<string, unknown> = { classes: classesProp(classList) };
  if (c.link) settings.link = linkProp(c.link, { blank: c.blank });
  const el: El = { id, elType, settings, styles, elements: [], editor_settings: { title: c.title }, version: "0.0", _css };
  if (widgetType) el.widgetType = widgetType;
  if (c.interaction) el.interactions = interactions(id, c.interaction);
  return el;
}

// Elementor's V4 base styles (`.elementor .e-flexbox-base`, `.e-div-block-base`, `.e-grid-base`)
// give every container padding:10px, every div-block min-width:30px, and every grid two equal
// rows + three equal columns, regardless of any class or local css we declare — see pitfalls.md.
// withDefaults prepends the neutralising declarations to an element's own local css (never a
// global class) so they always take effect without relying on the theme to not apply.
type ContainerKind = "flex" | "block" | "grid";

function declaredProps(css: string | undefined): string[] {
  if (!css) return [];
  return css.split(";").flatMap((raw) => {
    const decl = raw.trim();
    if (!decl) return [];
    const colon = decl.indexOf(":");
    if (colon < 0) return [];
    return [decl.slice(0, colon).trim().toLowerCase()];
  });
}

function declaresProp(css: string | undefined, prop: RegExp): boolean {
  return declaredProps(css).some((p) => prop.test(p));
}

function classesDeclareProp(classes: string[] | undefined, prop: RegExp): boolean {
  for (const label of classes ?? []) {
    const gc = CLASSES[label];
    if (!gc) continue;
    for (const css of Object.values(gc.css)) if (declaresProp(css, prop)) return true;
  }
  return false;
}

function ownCssDeclaresProp(css: CssMap | undefined, prop: RegExp): boolean {
  for (const v of Object.values(css ?? {})) if (declaresProp(v, prop)) return true;
  return false;
}

const MIN_WIDTH_RE = /^min-width$/;
const GRID_ROWS_RE = /^grid-template-rows$/;

// Which physical sides a padding-family property covers. A partial declaration (e.g. only
// `padding-top`) must not suppress the neutralising default on the OTHER sides, or Elementor's
// `.e-flexbox-base{padding:10px}` (etc.) base style keeps applying to whichever side nobody
// explicitly zeroed — see pitfalls.md ("Partial padding declarations").
type Side = "top" | "right" | "bottom" | "left";
const SIDE_ORDER: Side[] = ["top", "right", "bottom", "left"];
const PADDING_SIDES: Record<string, Side[]> = {
  padding: ["top", "right", "bottom", "left"],
  "padding-top": ["top"],
  "padding-right": ["right"],
  "padding-bottom": ["bottom"],
  "padding-left": ["left"],
  "padding-block": ["top", "bottom"],
  "padding-block-start": ["top"],
  "padding-block-end": ["bottom"],
  "padding-inline": ["left", "right"],
  "padding-inline-start": ["left"],
  "padding-inline-end": ["right"],
};

function coveredPaddingSides(props: string[]): Set<Side> {
  const covered = new Set<Side>();
  for (const prop of props) for (const side of PADDING_SIDES[prop] ?? []) covered.add(side);
  return covered;
}

function paddingCoverage(classes: string[] | undefined, css: CssMap | undefined): Set<Side> {
  const covered = new Set<Side>();
  for (const label of classes ?? []) {
    const gc = CLASSES[label];
    if (!gc) continue;
    for (const v of Object.values(gc.css)) for (const s of coveredPaddingSides(declaredProps(v))) covered.add(s);
  }
  for (const v of Object.values(css ?? {})) for (const s of coveredPaddingSides(declaredProps(v))) covered.add(s);
  return covered;
}

export function withDefaults(kind: ContainerKind, classes: string[] | undefined, css: CssMap | undefined): CssMap | undefined {
  const coveredSides = paddingCoverage(classes, css);
  const hasMinWidth = classesDeclareProp(classes, MIN_WIDTH_RE) || ownCssDeclaresProp(css, MIN_WIDTH_RE);
  const hasGridRows = classesDeclareProp(classes, GRID_ROWS_RE) || ownCssDeclaresProp(css, GRID_ROWS_RE);

  const prepend: string[] = [];
  if (kind === "grid" && !hasGridRows) prepend.push("grid-template-rows:auto");
  if (kind === "block" && !hasMinWidth) prepend.push("min-width:0");
  if (coveredSides.size === 0) {
    prepend.push("padding:0");
  } else if (coveredSides.size < 4) {
    for (const side of SIDE_ORDER) if (!coveredSides.has(side)) prepend.push(`padding-${side}:0`);
  }

  if (!prepend.length) return css;

  const desktop = css?.desktop ? `${prepend.join(";")};${css.desktop}` : prepend.join(";");
  return { ...(css ?? {}), desktop };
}

function container(kind: ContainerKind, elType: string) {
  return (path: string, c: Common & { tag?: ContainerTag }, children: El[]): El => {
    const css = withDefaults(kind, c.classes, c.css);
    const el = base(path, { ...c, css }, elType);
    el.settings.tag = str(c.tag ?? "div");
    el.elements = children;
    return el;
  };
}
export const flex = container("flex", "e-flexbox");
export const block = container("block", "e-div-block");
export const grid = container("grid", "e-grid");

export function heading(path: string, c: Common & { tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6"; text: string }): El {
  const el = base(path, c, "widget", "e-heading");
  el.settings.tag = str(c.tag);
  el.settings.title = html(c.text);
  return el;
}
export function text(path: string, c: Common & { text: string; tag?: "p" | "span" }): El {
  const el = base(path, c, "widget", "e-paragraph");
  el.settings.tag = str(c.tag ?? "p");
  el.settings.paragraph = html(c.text);
  return el;
}
export function button(path: string, c: Common & { text: string; link: string }): El {
  const el = base(path, c, "widget", "e-button");
  el.settings.text = html(c.text);
  return el;
}
export function svg(path: string, c: Common & { icon: string }): El {
  const el = base(path, c, "widget", "e-svg");
  el.settings.svg = svgRef(c.icon);
  return el;
}
export function image(path: string, c: Common & { media: string; alt: string }): El {
  const el = base(path, c, "widget", "e-image");
  el.settings.image = imageRef(c.media, c.alt);
  return el;
}
export function video(path: string, c: Common & { url: string; poster?: string }): El {
  const el = base(path, c, "widget", "e-self-hosted-video");
  el.settings.source = videoRef(c.url);
  el.settings.autoplay = bool(true); el.settings.mute = bool(true); el.settings.loop = bool(true);
  el.settings.playsinline = bool(true); el.settings.controls = bool(false); el.settings.preload = str("metadata");
  if (c.poster) { el.settings.poster_enabled = bool(true); el.settings.poster = imageRef(c.poster, ""); }
  return el;
}

export function collectCss(root: El): Record<string, CssMap> {
  const out: Record<string, CssMap> = { ...root._css };
  for (const child of root.elements) Object.assign(out, collectCss(child));
  return out;
}

export function assertUniqueIds(roots: El[]): void {
  const idMap: Map<string, string[]> = new Map();

  function walk(el: El) {
    if (!idMap.has(el.id)) {
      idMap.set(el.id, []);
    }
    idMap.get(el.id)!.push(el.editor_settings.title);
    for (const child of el.elements) walk(child);
  }

  for (const root of roots) walk(root);

  const duplicates: string[] = [];
  for (const [id, titles] of idMap) {
    if (titles.length > 1) {
      const titleList = titles.map(t => `"${t}"`).join(", ");
      duplicates.push(`duplicate element id ${id}: ${titleList}`);
    }
  }

  if (duplicates.length > 0) {
    throw new Error(duplicates.join("\n"));
  }
}

export type Recipe = { kind: "page" | "header" | "footer"; key: string; build(lang: Lang, media: MediaRegistry): El[] };
