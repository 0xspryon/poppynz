import { lintCssMap, type CssMap } from "./css";
import { globalClassId } from "./ids";
import { v } from "./tokens";

export type GlobalClass = { label: string; id: string; css: CssMap };

const BODY = `font-family:${v("font-body")}`;
const DISPLAY = `font-family:${v("font-display")}`;
const SHADOW_CARD = "box-shadow:0 1px 3px rgba(0,29,90,.06),0 8px 24px -12px rgba(0,29,90,.12)";
const SHADOW_DEEP = "box-shadow:0 28px 60px -30px rgba(0,29,90,.4)";
const SHADOW_SKY = "box-shadow:0 10px 24px -10px rgba(55,181,255,.65)";
const LIFT = "transform:translateY(-2px) scale(1.02)";

const defs: Record<string, CssMap> = {
  // layout
  wrap: { desktop: "max-width:1920px;margin-left:auto;margin-right:auto;width:100%" },
  sec: { desktop: "padding:clamp(56px,8vw,96px) clamp(24px,5vw,96px)" },
  "sec-x": { desktop: "padding-left:clamp(24px,5vw,96px);padding-right:clamp(24px,5vw,96px)" },
  band: { desktop: `background-color:${v("white")};border-top-width:1.5px;border-bottom-width:1.5px;border-style:solid;border-color:${v("line")}` },
  "band-top": { desktop: `background-color:${v("white")};border-top-width:1.5px;border-style:solid;border-color:${v("line")}` },
  navy: { desktop: `background-color:${v("navy")};color:${v("white")}` },
  "stack-16": { desktop: "display:flex;flex-direction:column;gap:16px" },
  "stack-20": { desktop: "display:flex;flex-direction:column;gap:20px" },
  "stack-24": { desktop: "display:flex;flex-direction:column;gap:24px" },
  "grid-2": { desktop: "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:clamp(32px,5vw,64px);align-items:center" },
  "grid-cards": { desktop: "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:20px" },
  "btn-row": { desktop: "display:flex;flex-wrap:wrap;gap:14px;align-items:center" },
  "btn-row-center": { desktop: "display:flex;flex-wrap:wrap;justify-content:center;gap:14px" },
  // type
  eyebrow: { desktop: `${BODY};font-weight:600;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${v("teal")};display:flex;align-items:center;gap:10px` },
  "eyebrow-light": { desktop: `${BODY};font-weight:600;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${v("sky-light")};display:flex;align-items:center;gap:10px` },
  dash: { desktop: "display:inline-block;width:22px;height:2px;border-radius:2px;background-color:currentColor" },
  label: { desktop: `${BODY};font-weight:600;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${v("teal")}` },
  h1: { desktop: `${DISPLAY};font-weight:800;font-size:clamp(38px,5vw,68px);line-height:1.05;letter-spacing:-.02em;color:${v("navy")}` },
  h2: { desktop: `${DISPLAY};font-weight:800;font-size:clamp(30px,3.6vw,44px);line-height:1.1;letter-spacing:-.02em;color:${v("navy")}` },
  "h2-light": { desktop: `${DISPLAY};font-weight:700;font-size:clamp(30px,3.6vw,44px);line-height:1.1;letter-spacing:-.02em;color:${v("white")}` },
  "h2-sm": { desktop: `${DISPLAY};font-weight:800;font-size:clamp(28px,3.4vw,40px);line-height:1.1;letter-spacing:-.02em;color:${v("navy")}` },
  "h2-cta": { desktop: `${DISPLAY};font-weight:800;font-size:clamp(32px,4.2vw,52px);line-height:1.05;letter-spacing:-.02em;color:${v("navy")}` },
  h3: { desktop: `${DISPLAY};font-weight:700;font-size:21px;letter-spacing:-.01em;color:${v("navy")}` },
  "h3-lg": { desktop: `${DISPLAY};font-weight:700;font-size:24px;letter-spacing:-.01em;color:${v("navy")}` },
  "h3-light": { desktop: `${DISPLAY};font-weight:700;font-size:24px;letter-spacing:-.01em;color:${v("white")}` },
  "hl-wavy": { desktop: "" },
  "em-accent": { desktop: "" },
  accent: { desktop: `color:${v("sky")}` },
  lead: { desktop: `${BODY};font-size:17px;line-height:1.6;color:${v("muted")}` },
  "lead-light": { desktop: `${BODY};font-size:17px;line-height:1.6;color:${v("navy-text")}` },
  "lead-lg": { desktop: `${BODY};font-size:clamp(16px,1.4vw,19px);line-height:1.6;color:${v("muted")};max-width:540px` },
  "body-15": { desktop: `${BODY};font-size:15px;line-height:1.55;color:${v("muted")}` },
  "body-15-light": { desktop: `${BODY};font-size:15px;line-height:1.6;color:${v("navy-text")}` },
  "body-16": { desktop: `${BODY};font-size:16px;line-height:1.6;color:${v("muted")}` },
  "body-18": { desktop: `${BODY};font-size:18px;line-height:1.6;color:${v("muted")}` },
  "muted-14": { desktop: `${BODY};font-size:14px;line-height:1.5;color:${v("muted")}` },
  "muted-13": { desktop: `${BODY};font-size:13px;line-height:1.5;color:${v("muted")}` },
  "note-light": { desktop: `display:flex;align-items:center;gap:8px;${BODY};font-size:13px;color:${v("navy-note")}` },
  trust: { desktop: `display:flex;align-items:flex-start;gap:8px;${BODY};font-size:14px;line-height:1.5;color:${v("muted")}` },
  // buttons
  "btn-primary": {
    desktop: `display:inline-block;padding:16px 30px;border-radius:999px;background-color:${v("sky")};color:${v("white")};${BODY};font-weight:600;font-size:16px;text-decoration:none;${SHADOW_SKY};transition:transform .25s`,
    "desktop:hover": `background-color:${v("sky-hover")};color:${v("white")};${LIFT}`,
    mobile: "padding:14px 24px",
  },
  "btn-primary-14": {
    desktop: `display:inline-block;padding:14px 26px;border-radius:999px;background-color:${v("sky")};color:${v("white")};${BODY};font-weight:600;font-size:15px;text-decoration:none;${SHADOW_SKY};transition:transform .25s`,
    "desktop:hover": `background-color:${v("sky-hover")};color:${v("white")};${LIFT}`,
  },
  "btn-outline": {
    desktop: `display:inline-block;padding:15px 26px;border-radius:8px;border-width:1.5px;border-style:solid;border-color:${v("navy")};color:${v("navy")};${BODY};font-weight:600;font-size:16px;text-decoration:none`,
    "desktop:hover": `background-color:${v("tint-2")}`,
  },
  "btn-ghost-light-15": {
    desktop: `display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:8px;border-width:1.5px;border-style:solid;border-color:rgba(255,255,255,.35);color:${v("white")};${BODY};font-weight:600;font-size:15px;text-decoration:none`,
    "desktop:hover": `background-color:rgba(255,255,255,.08);color:${v("white")}`,
  },
  "link-arrow": {
    desktop: `display:inline-flex;align-items:center;gap:8px;${BODY};font-weight:600;font-size:15px;color:${v("navy")};text-decoration:none`,
    "desktop:hover": `color:${v("teal")}`,
  },
  signin: {
    desktop: `padding:10px 14px;border-radius:8px;${BODY};font-weight:600;font-size:15px;color:${v("navy")};text-decoration:none`,
    "desktop:hover": `background-color:${v("tint-2")}`,
  },
  getstarted: {
    desktop: `padding:11px 22px;border-radius:999px;background-color:${v("sky")};color:${v("white")};${BODY};font-weight:600;font-size:15px;text-decoration:none;${SHADOW_SKY};transition:transform .25s`,
    "desktop:hover": `background-color:${v("sky-hover")};color:${v("white")};${LIFT}`,
  },
  "nav-link": {
    desktop: `padding:8px 12px;border-radius:8px;${BODY};font-weight:500;font-size:15px;color:${v("navy")};text-decoration:none;display:inline-flex;align-items:center;gap:6px`,
    "desktop:hover": `background-color:${v("tint-2")}`,
  },
  "badge-new": { desktop: `display:inline-flex;align-items:center;padding:2px 6px;border-radius:999px;background-color:${v("pink")};color:${v("magenta-ink")};${BODY};font-weight:700;font-size:10px;letter-spacing:.06em;text-transform:uppercase` },
  lang: { desktop: `display:flex;border-width:1.5px;border-style:solid;border-color:${v("line-2")};border-radius:8px;padding:2px;gap:0` },
  // lang-on before lang-item: see the svc-pink/svc note above (Elementor prints global classes
  // in reversed declaration order) — lang-on's `color` must win over lang-item's.
  "lang-on": { desktop: `background-color:${v("navy")};color:${v("white")}` },
  "lang-item": { desktop: `padding:5px 9px;border-radius:6px;color:${v("muted")};${BODY};font-weight:600;font-size:12px;letter-spacing:.04em;text-decoration:none` },
  // icons
  "icon-18": { desktop: "width:18px;height:18px" },
  "icon-20": { desktop: "width:20px;height:20px" },
  "icon-22": { desktop: "width:22px;height:22px" },
  "icon-24": { desktop: "width:24px;height:24px" },
  "icon-teal": { desktop: `color:${v("teal")}` },
  "icon-ok": { desktop: `color:${v("ok")}` },
  "icon-sky": { desktop: `color:${v("sky")}` },
  "icon-sky-light": { desktop: `color:${v("sky-light")}` },
  "icon-magenta": { desktop: `color:${v("magenta")}` },
  "icon-white": { desktop: `color:${v("white")}` },
  // bubbles, avatars, chips
  // bubble-40/48 before bubble: see the svc-pink/svc note above — their width/height must win
  // over bubble's own 44px default.
  "bubble-40": { desktop: "width:40px;height:40px" },
  "bubble-48": { desktop: "width:48px;height:48px" },
  bubble: { desktop: `display:flex;width:44px;height:44px;align-items:center;justify-content:center;border-radius:999px;background-color:${v("tint")};transition:transform .3s`, "desktop:hover": "transform:rotate(-8deg) scale(1.1)" },
  "bubble-light": { desktop: "display:flex;width:48px;height:48px;align-items:center;justify-content:center;border-radius:999px;background-color:rgba(255,255,255,.1)" },
  avatar: { desktop: `display:flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:999px;background-color:${v("sky")};color:${v("white")};${BODY};font-weight:700;font-size:14px` },
  vetted: { desktop: `display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:4px;background-color:${v("ok-bg")};color:${v("ok")};${BODY};font-weight:600;font-size:12px` },
  city: { desktop: `display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;background-color:${v("tint")};${BODY};font-weight:500;font-size:14px;color:${v("navy")};transition:transform .25s`, "desktop:hover": "transform:translateY(-3px) rotate(-2deg)" },
  "city-next": { desktop: `display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;border-width:1.5px;border-style:dashed;border-color:${v("line-2")};${BODY};font-weight:500;font-size:14px;color:${v("muted")};transform:rotate(-2deg)` },
  // cards
  card: { desktop: `display:flex;flex-direction:column;gap:14px;padding:28px;border-radius:8px;border-width:1.5px;border-style:solid;border-color:${v("line")};background-color:${v("page")};transition:transform .25s` },
  "card-lift": { "desktop:hover": `border-color:${v("sky-light")};background-color:${v("tint-2")};transform:translateY(-4px) rotate(-0.6deg)` },
  "card-lift-r": { "desktop:hover": `border-color:${v("sky-light")};background-color:${v("tint-2")};transform:translateY(-4px) rotate(0.6deg)` },
  "hero-card": { desktop: `display:flex;flex-direction:column;gap:14px;padding:22px;border-radius:12px;background-color:${v("white")};border-width:1.5px;border-style:solid;border-color:${v("line")};${SHADOW_CARD};text-decoration:none;transition:transform .25s` },
  "hero-card-l": { "desktop:hover": `border-color:${v("sky")};background-color:${v("tint-2")};transform:translateY(-4px) rotate(-0.8deg)` },
  "hero-card-r": { "desktop:hover": `border-color:${v("navy")};background-color:${v("tint-2")};transform:translateY(-4px) rotate(0.8deg)` },
  "hero-card-title": { desktop: `${DISPLAY};font-weight:700;font-size:18px;color:${v("navy")}` },
  "hero-card-text": { desktop: `${BODY};font-size:14px;line-height:1.5;color:${v("muted")}` },
  "go-sky": { desktop: `display:inline-flex;align-self:flex-start;align-items:center;gap:8px;padding:10px 18px;color:${v("white")};${BODY};font-weight:600;font-size:14px;border-radius:999px;background-color:${v("sky")};${SHADOW_SKY}` },
  "go-navy": { desktop: `display:inline-flex;align-self:flex-start;align-items:center;gap:8px;padding:10px 18px;color:${v("white")};${BODY};font-weight:600;font-size:14px;border-radius:8px;background-color:${v("navy")}` },
  "step-num": { desktop: `${BODY};font-weight:700;font-size:13px;letter-spacing:.08em;color:${v("teal")};display:inline-block;transform:rotate(6deg)` },
  "step-top": { desktop: "display:flex;justify-content:space-between;align-items:center;width:100%" },
  // svc-pink must be declared before svc: Elementor prints global classes in REVERSED
  // declaration order (Atomic_Global_Styles::get_document_global_styles() reverses $ordered_class_ids
  // before building the css bundle), so a modifier meant to override a base class's static
  // properties has to sort earlier in this file, not later. See pitfalls.md.
  "svc-pink": { desktop: `background-color:${v("pink")};border-color:${v("pink-line")}`, "desktop:hover": `border-color:${v("magenta")}` },
  svc: { desktop: `position:relative;display:flex;flex-direction:column;gap:10px;min-height:320px;padding:24px 24px 0;border-radius:12px;border-width:1.5px;border-style:solid;border-color:${v("tint-line")};background-color:${v("tint")};overflow:hidden;text-decoration:none;transition:transform .25s`, "desktop:hover": `border-color:${v("sky-light")};transform:translateY(-4px) rotate(0.6deg)` },
  "svc-title": { desktop: `${DISPLAY};font-weight:700;font-size:21px;letter-spacing:-.01em;color:${v("navy")}` },
  "svc-text": { desktop: `${BODY};font-size:14px;line-height:1.5;color:${v("muted")};max-width:30ch` },
  "svc-art": { desktop: "display:block;align-self:flex-end;margin-top:auto;margin-right:-4px;margin-bottom:-6px;height:160px;width:auto;object-fit:contain;filter:drop-shadow(0 6px 10px rgba(0,29,90,.12))" },
  quote: { desktop: `display:flex;flex-direction:column;gap:20px;padding:32px;border-radius:8px;background-color:${v("white")};border-width:1.5px;border-style:solid;border-color:${v("line")};${SHADOW_CARD};transition:transform .3s`, "desktop:hover": "transform:rotate(0deg) translateY(-4px)" },
  "quote-text": { desktop: `${DISPLAY};font-weight:500;font-style:italic;font-size:22px;line-height:1.45;color:${v("navy")}` },
  "quote-who": { desktop: "display:flex;align-items:center;gap:12px;margin-top:auto" },
  panel: { desktop: `display:flex;flex-direction:column;gap:20px;padding:32px;border-radius:14px;background-color:${v("white")};border-width:1.5px;border-style:solid;border-color:${v("line")};${SHADOW_CARD}` },
  "panel-navy": { desktop: `display:flex;flex-direction:column;gap:20px;padding:32px;border-radius:14px;background-color:${v("navy")};color:${v("white")};${SHADOW_DEEP}` },
  "card-shadow": { desktop: SHADOW_CARD },
  "shadow-deep": { desktop: SHADOW_DEEP },
  checks: { desktop: `display:flex;flex-direction:column;gap:12px;${BODY};font-size:15px;line-height:1.5;color:${v("muted")}` },
  "check-row": { desktop: "display:flex;gap:10px;align-items:flex-start" },
  credibled: { desktop: `display:flex;align-items:center;gap:10px;margin-top:auto;padding:12px 14px;border-radius:8px;background-color:${v("orange-bg")};border-width:1.5px;border-style:solid;border-color:${v("orange-line")};${BODY};font-weight:500;font-size:13px;line-height:1.4;color:${v("ink")}` },
  dot: { desktop: `flex:0 0 auto;width:10px;height:10px;border-radius:999px;background-color:${v("orange")}` },
  "float-card": { desktop: `position:absolute;inset-inline-end:16px;inset-block-start:24px;display:flex;align-items:center;gap:12px;padding:12px 14px;background-color:${v("white")};border-width:1.5px;border-style:solid;border-color:${v("line")};border-radius:8px;${SHADOW_CARD}` },
  "media-box": { desktop: `position:relative;height:clamp(320px,45vw,640px);border-radius:14px;overflow:hidden;${SHADOW_DEEP};background-color:${v("tint")}` },
  "cta-inner": { desktop: "display:flex;flex-direction:column;align-items:center;gap:24px;text-align:center;padding:clamp(56px,8vw,96px) clamp(24px,5vw,96px)" },
  // footer
  ftr: { desktop: `padding:clamp(48px,6vw,64px) clamp(24px,5vw,96px) 40px;background-color:${v("page")};border-top-width:1.5px;border-style:solid;border-color:${v("line")}` },
  "ftr-grid": { desktop: "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:40px" },
  "ftr-col": { desktop: "display:flex;flex-direction:column;gap:12px" },
  "ftr-link": { desktop: `${BODY};font-size:15px;color:${v("navy")};text-decoration:none`, "desktop:hover": `color:${v("teal")}` },
  "ftr-bottom": { desktop: `display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;margin-top:48px;padding-top:24px;border-top-width:1.5px;border-style:solid;border-color:${v("line")};${BODY};font-size:13px;color:${v("muted")}` },
  brand: { desktop: `display:inline-flex;align-items:center;gap:10px;${DISPLAY};font-weight:800;font-size:20px;letter-spacing:-.02em;color:${v("navy")};text-decoration:none` },
  "brand-mark": { desktop: "width:32px;height:32px" },
  hdr: { desktop: `position:sticky;inset-block-start:0;z-index:20;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;column-gap:24px;padding:14px clamp(24px,5vw,96px);border-bottom-width:1.5px;border-style:solid;border-color:${v("line")};background-color:rgba(247,249,255,.94);backdrop-filter:blur(8px)` },
  "hdr-nav": { desktop: "display:flex;flex-wrap:wrap;justify-content:center;gap:4px;flex:1 1 auto" },
  "hdr-actions": { desktop: "display:flex;align-items:center;gap:12px" },
  // hero decorations
  deco: { desktop: "position:absolute;inset-block-start:0;inset-inline-start:0;width:100%;height:100%;overflow:hidden;z-index:0" },
  "deco-d1": { desktop: `position:absolute;inset-inline-start:6%;inset-block-start:14%;width:14px;height:14px;border-radius:999px;background-color:${v("tint-line")}` },
  "deco-d2": { desktop: `position:absolute;inset-inline-start:44%;inset-block-start:8%;width:9px;height:9px;border-radius:999px;background-color:${v("magenta")};opacity:55%` },
  "deco-d3": { desktop: `position:absolute;inset-inline-start:52%;inset-block-start:70%;width:22px;height:22px;color:${v("sky")}` },
  "deco-d4": { desktop: `position:absolute;inset-inline-start:2%;inset-block-end:12%;width:22px;height:22px;border-radius:999px;border-width:2px;border-style:solid;border-color:${v("sky-light")}` },
  "deco-d5": { desktop: `position:absolute;inset-inline-end:4%;inset-block-end:18%;width:18px;height:18px;color:${v("magenta")};opacity:50%` },
  "hero-copy": { desktop: "position:relative;z-index:1;display:flex;flex-direction:column;gap:28px" },
  hero: { desktop: "position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:clamp(32px,5vw,64px);padding:clamp(48px,7vw,80px) clamp(24px,5vw,96px);align-items:center;max-width:1920px;margin-left:auto;margin-right:auto" },
};

export const ANIM_CLASSES = ["anim-float", "anim-wave", "anim-bob", "anim-wiggle", "anim-wiggle-badge", "anim-beat", "anim-twinkle", "anim-drift", "anim-drift-rev", "anim-drift-slow", "anim-ring"];
for (const a of ANIM_CLASSES) defs[a] = { desktop: "" };

export const CLASSES: Record<string, GlobalClass> = Object.fromEntries(
  Object.entries(defs).map(([label, css]) => [label, { label, id: globalClassId(label), css }]),
);

export function cls(label: string): string {
  if (!CLASSES[label]) throw new Error(`cls(): global class "${label}" is not declared in classes.ts`);
  return label;
}

export function lintClasses(): string[] {
  return Object.values(CLASSES).flatMap((c) => lintCssMap(c.css, c.label));
}
