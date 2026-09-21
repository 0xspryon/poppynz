import { cls } from "./classes";
import { lintCssMap, normalizeCss, parseCssKey, type CssMap } from "./css";
import { elementId, localStyleId } from "./ids";
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

function container(elType: string) {
  return (path: string, c: Common & { tag?: ContainerTag }, children: El[]): El => {
    const el = base(path, c, elType);
    el.settings.tag = str(c.tag ?? "div");
    el.elements = children;
    return el;
  };
}
export const flex = container("e-flexbox");
export const block = container("e-div-block");
export const grid = container("e-grid");

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
