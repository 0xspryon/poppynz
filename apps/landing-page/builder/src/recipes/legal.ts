import { LEGAL, LEGAL_COMMON, LEGAL_DOCS, type LegalDocKey, type LegalSection } from "../content/legal";
import type { Lang } from "../content/types";
import { block, button, flex, heading, svg, text, type El, type Recipe } from "../dsl";
import type { MediaRegistry } from "../media";

// Privacy Policy, Terms of Service and Service Agreement are the same page with different copy:
// a navy hero carrying the three-way tab switcher, a sticky table of contents, and a column of
// numbered `legal-sec` blocks. `legalRecipe(doc)` builds one of them; cli.ts registers all three,
// so the six pages (three documents x two languages) all come out of this one file.

// The kit sets the body line-height in `em`, which every descendant inherits as a FIXED 19.2px
// instead of re-resolving against its own font-size (see references/poppynz.md § "the kit's body
// line-height"). Shared classes are left alone so the pages already live do not move; every
// element this page owns that the kit would mis-size states the design's own line box locally.
// These are Chrome's `line-height:normal` boxes for the two webfonts, measured in the design.
const EYEBROW_LH = "line-height:15px"; // 12px Inter
const NOTE_LH = "line-height:16px"; //    13px Inter

// The design's h1 carries no class at all, so it gets neither the shared `h1` class's navy colour
// and clamp nor the theme's `text-wrap:balance`. Declared locally for that reason, the same move
// the daycare page makes for its three unbalanced headings.
const H1_LIGHT = "font-family:var(--font-display);font-weight:800;font-size:clamp(36px,4.4vw,56px);line-height:1.05;letter-spacing:-.02em;color:var(--white)";

const anchorId = (i: number) => `s${i + 1}`;

/** The design's `<li><i class="las la-check"></i><span>…</span></li>`. */
function item(path: string, txt: string): El {
  return flex(path, { title: txt.slice(0, 60), classes: ["legal-li"] }, [
    svg(`${path}/i`, { title: "Check", classes: ["legal-tick"], icon: "icon:check" }),
    text(`${path}/t`, { title: "Text", tag: "span", text: txt }),
  ]);
}

function list(path: string, items: string[]): El {
  return flex(path, { title: "List", classes: ["legal-list"] }, items.map((t, i) => item(`${path}/${i}`, t)));
}

function section(path: string, s: LegalSection, i: number): El {
  return flex(path, { title: s.title, tag: "section", classes: ["legal-sec"], cssId: anchorId(i) }, [
    flex(`${path}/head`, { title: "Head", classes: ["legal-head"] }, [
      // The design leaves the number out entirely on an unnumbered section (the Privacy Policy's
      // closing "Key Considerations for Canadian Privacy"), so the heading sits flush left.
      ...(s.n ? [text(`${path}/n`, { title: s.n, tag: "span", classes: ["legal-num"], text: s.n })] : []),
      heading(`${path}/h2`, { title: s.title, tag: "h2", classes: ["legal-h2"], text: s.title }),
    ]),
    ...(s.lead ? [text(`${path}/lead`, { title: "Lead", classes: ["legal-p"], text: s.lead })] : []),
    ...(s.subs ?? []).map((sub, j) => flex(`${path}/sub/${j}`, { title: sub.title, classes: ["legal-sub"] }, [
      heading(`${path}/sub/${j}/h3`, { title: sub.title, tag: "h3", classes: ["legal-h3"], text: sub.title }),
      list(`${path}/sub/${j}/list`, sub.items),
    ])),
    ...(s.items ? [list(`${path}/list`, s.items)] : []),
    ...(s.tail ? [text(`${path}/tail`, { title: "Tail", classes: ["legal-tail"], text: s.tail })] : []),
  ]);
}

export function legalRecipe(doc: LegalDocKey): Recipe {
  return {
    kind: "page", key: doc,
    build(lang: Lang, media: MediaRegistry): El[] {
      const c = LEGAL[doc][lang];
      const common = LEGAL_COMMON[lang];
      for (const n of ["calendar", "check", "envelope"]) media.icon(n);
      const p = `legal/${doc}`;

      // ------------------------------------------------------------------ Hero
      const hero = flex(`${p}/hero`, { title: "Legal hero", tag: "section", classes: ["navy"] }, [
        flex(`${p}/hero/wrap`, {
          title: "Wrap", classes: ["wrap"],
          css: { desktop: "flex-direction:column;gap:18px;padding:clamp(48px,6vw,72px) clamp(24px,5vw,96px)" },
          // The design's `animation:rise .6s` — translateY(14px) plus a fade, which is exactly a
          // load-triggered slide-from-bottom interaction.
          interaction: { trigger: "load", effect: "slide", direction: "bottom", durationMs: 600 },
        }, [
          // The switcher between the three documents. Each pill links by page key, so
          // resolveLinks() points it at the right slug for the language being built.
          flex(`${p}/hero/tabs`, { title: "Document tabs", classes: ["legal-tabs"] },
            LEGAL_DOCS.map((k) => button(`${p}/hero/tabs/${k}`, {
              title: LEGAL[k][lang].title,
              classes: k === doc ? ["legal-tab-on", "legal-tab"] : ["legal-tab"],
              text: LEGAL[k][lang].title,
              link: `page:${k}`,
            }))),
          flex(`${p}/hero/eyebrow`, { title: "Eyebrow", classes: ["eyebrow-light"], css: { desktop: EYEBROW_LH } }, [
            // The design's `.dash-still`: the shared `dash` without the wiggle animation.
            block(`${p}/hero/eyebrow/dash`, { title: "Dash", classes: ["dash"] }, []),
            text(`${p}/hero/eyebrow/t`, { title: common.eyebrow, tag: "span", text: common.eyebrow }),
          ]),
          heading(`${p}/hero/h1`, { title: "H1", tag: "h1", css: { desktop: H1_LIGHT }, text: c.title }),
          text(`${p}/hero/intro`, { title: "Intro", classes: ["lead-light"], css: { desktop: "max-width:760px" }, text: c.intro }),
          flex(`${p}/hero/note`, { title: "Date", classes: ["note-light"], css: { desktop: NOTE_LH } }, [
            svg(`${p}/hero/note/i`, { title: "Calendar", css: { desktop: "flex:0 0 auto;width:16px;height:16px" }, icon: "icon:calendar" }),
            text(`${p}/hero/note/t`, { title: "Date", tag: "span", text: c.note }),
          ]),
        ]),
      ]);

      // ------------------------------------------------------------------ Body
      const toc = flex(`${p}/toc`, { title: "On this page", tag: "aside", classes: ["legal-toc"] }, [
        text(`${p}/toc/label`, { title: common.tocLabel, tag: "span", classes: ["label"], css: { desktop: `margin-bottom:6px;${EYEBROW_LH}` }, text: common.tocLabel }),
        ...c.sections.map((s, i) => flex(`${p}/toc/${i}`, { title: s.title, tag: "a", classes: ["toc-link"], link: `#${anchorId(i)}` }, [
          // An unnumbered section still gets the number slot, empty, so its label lines up with
          // every other row (the design does the same).
          text(`${p}/toc/${i}/n`, { title: s.n ?? "No number", tag: "span", classes: ["toc-num"], text: s.n ?? "" }),
          text(`${p}/toc/${i}/t`, { title: s.title, tag: "span", text: s.title }),
        ])),
      ]);

      const article = flex(`${p}/article`, { title: "Document", tag: "article", classes: ["legal-article"] }, [
        ...c.sections.map((s, i) => section(`${p}/sec/${i}`, s, i)),
        flex(`${p}/contact`, { title: "Questions", classes: ["legal-contact"] }, [
          text(`${p}/contact/t`, { title: "Text", classes: ["body-15"], css: { desktop: "line-height:1.5" }, text: common.contact }),
          flex(`${p}/contact/a`, { title: common.contactEmail, tag: "a", classes: ["legal-contact-btn"], link: `mailto:${common.contactEmail}` }, [
            svg(`${p}/contact/a/i`, { title: "Envelope", css: { desktop: "flex:0 0 auto;width:14px;height:14px" }, icon: "icon:envelope" }),
            text(`${p}/contact/a/t`, { title: common.contactEmail, tag: "span", text: common.contactEmail }),
          ]),
        ]),
      ]);

      const body = flex(`${p}/body`, { title: "Legal body", tag: "section", classes: ["legal-body"] }, [toc, article]);

      return [hero, body];
    },
  };
}
