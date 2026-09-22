export type Breakpoint = "desktop" | "tablet" | "mobile";
export type StateKey = "hover" | "focus" | "active";
export type CssKey = Breakpoint | `${Breakpoint}:${StateKey}`;
export type CssMap = Partial<Record<CssKey, string>>;

const BREAKPOINTS: readonly Breakpoint[] = ["desktop", "tablet", "mobile"];
const STATES: readonly StateKey[] = ["hover", "focus", "active"];

export function parseCssKey(key: string): { breakpoint: Breakpoint; state: StateKey | null } {
  const [bp, state] = key.split(":");
  if (!BREAKPOINTS.includes(bp as Breakpoint)) throw new Error(`unknown breakpoint "${bp}" in "${key}"`);
  if (state !== undefined && !STATES.includes(state as StateKey)) throw new Error(`unknown state "${state}" in "${key}"`);
  return { breakpoint: bp as Breakpoint, state: (state as StateKey) ?? null };
}

const BANNED: Record<string, string> = {
  font: "`font` shorthand is dropped by Elementor; use font-weight/font-size/font-family",
  inset: "`inset` shorthand is dropped by Elementor; use inset-block-start etc.",
  "text-wrap": "`text-wrap` is not in the V4 style schema",
  "text-underline-offset": "`text-underline-offset` is not in the V4 style schema",
  "pointer-events": "`pointer-events` is never converted by the 4.2.4 atomic CSS converter, and Free strips it as customCss anyway; it cannot be expressed in this stack at all",
  "border-top-style": "per-side `border-*-style` is always left in customCss and aborts the import; use the unified `border-style` plus explicit per-side `border-*-width` (zero the sides you are not giving a real width)",
  "border-right-style": "per-side `border-*-style` is always left in customCss and aborts the import; use the unified `border-style` plus explicit per-side `border-*-width` (zero the sides you are not giving a real width)",
  "border-bottom-style": "per-side `border-*-style` is always left in customCss and aborts the import; use the unified `border-style` plus explicit per-side `border-*-width` (zero the sides you are not giving a real width)",
  "border-left-style": "per-side `border-*-style` is always left in customCss and aborts the import; use the unified `border-style` plus explicit per-side `border-*-width` (zero the sides you are not giving a real width)",
  "flex-grow": "`flex-grow` longhand is never converted; use the `flex` shorthand (`flex:<grow> <shrink> <basis>`)",
  "flex-shrink": "`flex-shrink` longhand is never converted; use the `flex` shorthand (`flex:<grow> <shrink> <basis>`)",
  "flex-basis": "`flex-basis` longhand is never converted; use the `flex` shorthand (`flex:<grow> <shrink> <basis>`)",
};

// `min-*`/`max-*` are the size properties whose CSS-wide keyword resets the 4.2.4 converter cannot
// express: it emits a prop only for a length or a percentage, and silently leaves anything else in
// customCss, which Free strips and the importer aborts on. Confirmed live with
// pz_converter()->convert() for each keyword below. `width`/`height` are deliberately NOT in this
// set: `width:auto` does convert and several classes rely on it.
const SIZE_PROPS = new Set(["min-width", "max-width", "min-height", "max-height"]);
const SIZE_KEYWORDS = new Set(["none", "initial", "unset", "inherit", "revert", "auto"]);

export function lintCss(css: string): string[] {
  const out: string[] = [];
  for (const raw of css.split(";")) {
    const decl = raw.trim();
    if (!decl) continue;
    const colon = decl.indexOf(":");
    if (colon < 0) { out.push(`\`${decl}\` has no colon`); continue; }
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (BANNED[prop]) out.push(BANNED[prop]);
    else if (prop === "animation" || prop.startsWith("animation-")) out.push(`\`${prop}\` is rejected by Elementor; use an anim-* class`);
    else if (prop === "transition" && /\b(cubic-bezier|ease|linear|steps)\b/.test(value)) out.push("`transition` easing is dropped by Elementor; write `transition: <prop> <duration>` only");
    else if (prop === "gap" && value.split(/\s+/).filter(Boolean).length > 1) out.push("two-value `gap:<row> <col>` is never converted; use `gap:<row>;column-gap:<col>`");
    else if (prop === "opacity" && /^-?\d*\.?\d+$/.test(value)) out.push("unitless decimal `opacity` is never converted; use a percentage, e.g. `opacity:50%`");
    else if (prop === "transform" && /rotate[xyz]?\(\s*0\s*\)/i.test(value)) out.push("a unitless zero angle in `transform` (e.g. `rotate(0)`) is never converted; use an explicit unit, e.g. `rotate(0deg)`");
    else if (SIZE_PROPS.has(prop) && SIZE_KEYWORDS.has(value.toLowerCase())) out.push(`\`${prop}:${value}\` is never converted — the size properties take only lengths and percentages, so a keyword reset lands in customCss and aborts the import; override with a real value instead (e.g. \`max-width:100%\`)`);
  }
  return out;
}

export function lintCssMap(map: CssMap, where: string): string[] {
  const out: string[] = [];
  for (const [key, css] of Object.entries(map)) {
    parseCssKey(key);
    for (const v of lintCss(css ?? "")) out.push(`${where}/${key}: ${v}`);
  }
  return out;
}

export function normalizeCss(css: string): string {
  return css
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      return i < 0 ? d : `${d.slice(0, i).trim()}:${d.slice(i + 1).trim().replace(/\s+/g, " ")}`;
    })
    .join(";");
}
