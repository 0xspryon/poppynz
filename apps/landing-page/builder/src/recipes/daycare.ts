import { DAYCARE } from "../content/daycare";
import { block, button, flex, grid, heading, image, svg, text, video, type Recipe } from "../dsl";
import { APP } from "../pages";

// The kit sets the body line-height in `em`, which every descendant inherits as a FIXED 19.2px
// instead of re-resolving against its own font-size (see poppynz.md § "the kit's body line-height").
// Shared classes are left alone so the pages already live do not move; every element this page owns
// that the kit would mis-size carries the design's own measured line box locally instead. The values
// are Chrome's own `line-height:normal` boxes for the two webfonts, measured in the design at 1280.
const EYEBROW_LH = "line-height:15px"; // 12px Inter
const H3_LH = "line-height:27px"; //      21px Hanken Grotesk
const BTN_LH = "line-height:20px"; //     16px Inter
const BTN_LH_15 = "line-height:19px"; //  15px Inter
const BTN_LH_14 = "line-height:17px"; //  14px Inter
const NUM_LH = "line-height:16px"; //     13px Inter
const CREDIT_LH = "line-height:14px"; //  11px Inter

// The design opts three of its headings out of balanced wrapping (`text-wrap:initial`), and the
// theme applies `text-wrap:balance` to every heading class. Those three therefore cannot carry the
// class at all and state the same declarations locally instead — same as the safety page's
// "What we never do" heading. Only the navy panel's h2 and the hero h1 stay balanced.
const H2_UNBALANCED = `font-family:var(--font-display);font-weight:800;font-size:clamp(30px,3.6vw,44px);line-height:1.1;letter-spacing:-.02em;color:var(--navy)`;
const H2_SM_UNBALANCED = `font-family:var(--font-display);font-weight:800;font-size:clamp(28px,3.4vw,40px);line-height:1.1;letter-spacing:-.02em;color:var(--navy)`;
const H2_CTA_UNBALANCED = `font-family:var(--font-display);font-weight:800;font-size:clamp(32px,4vw,48px);line-height:1.05;letter-spacing:-.02em;color:var(--navy)`;

const icon = (path: string, name: string, cls: string[], desktopCss?: string) =>
  svg(path, { title: name, classes: cls, icon: `icon:${name}`, ...(desktopCss ? { css: { desktop: desktopCss } } : {}) });

const dashEyebrow = (path: string, label: string, light = false) =>
  flex(path, { title: "Eyebrow", classes: [light ? "eyebrow-light" : "eyebrow"], css: { desktop: EYEBROW_LH } }, [
    block(`${path}/dash`, { title: "Dash", classes: ["dash", "anim-wiggle"] }, []),
    text(`${path}/label`, { title: label, tag: "span", text: label }),
  ]);

const plainEyebrow = (path: string, label: string) =>
  text(path, { title: "Eyebrow", classes: ["eyebrow"], css: { desktop: EYEBROW_LH }, text: label });

export const daycareRecipe: Recipe = {
  kind: "page", key: "daycare",
  build(lang, media) {
    const c = DAYCARE[lang];
    for (const n of ["star", "heart", "shield-alt", "map-marker", "child", "calendar", "bell"]) media.icon(n);
    media.add("ill:providers.webp", "../../design/assets/illustrations/providers.webp", c.daycares.alt);

    // ---------------------------------------------------------------- Hero
    // The shared `hero` class with two local overrides: this design's columns break at 400px
    // (not 460) and its gap is a flat 64px (not the clamp). A local style always beats a global
    // class, so neither override disturbs the other heroes.
    const hero = flex("daycare/hero", { title: "Hero", tag: "section", classes: ["hero"], css: { desktop: "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:64px" } }, [
      block("daycare/hero/deco", { title: "Decorations", classes: ["deco"] }, [
        block("daycare/hero/deco/1", { title: "Dot", classes: ["deco-d1", "anim-drift"] }, []),
        block("daycare/hero/deco/2", { title: "Dot", classes: ["deco-d2", "anim-drift-rev"] }, []),
        icon("daycare/hero/deco/3", "star", ["deco-d3", "anim-twinkle"]),
        block("daycare/hero/deco/4", { title: "Ring", classes: ["deco-d4", "anim-drift-slow"] }, []),
        icon("daycare/hero/deco/5", "heart", ["deco-d5", "anim-bob"]),
      ]),
      flex("daycare/hero/copy", { title: "Copy", classes: ["hero-copy"], css: { desktop: "gap:24px" }, interaction: { trigger: "load", effect: "slide", direction: "bottom", durationMs: 700 } }, [
        dashEyebrow("daycare/hero/eyebrow", c.hero.eyebrow),
        // The `h1` class carries the theme's text-wrap:balance; only the size differs here.
        heading("daycare/hero/h1", { title: "H1", tag: "h1", classes: ["h1"], css: { desktop: "font-size:clamp(38px,4.6vw,60px)" }, text: c.hero.title }),
        // `lead-lg` is the right colour, line-height and 540px cap; this design's size is a flat
        // 19px rather than the shared clamp.
        text("daycare/hero/lead", { title: "Lead", classes: ["lead-lg"], css: { desktop: "font-size:19px" }, text: c.hero.lead }),
        flex("daycare/hero/btns", { title: "Buttons", classes: ["btn-row"] }, [
          button("daycare/hero/primary", { title: c.hero.primary, classes: ["btn-primary-15"], css: { desktop: BTN_LH }, text: c.hero.primary, link: APP.signUp }),
          // The design's `.btn-outline-14` is `.btn-outline` with 14px 24px padding, and it is used
          // exactly once on this page, so it is a local override rather than a global class.
          button("daycare/hero/secondary", { title: c.hero.secondary, classes: ["btn-outline"], css: { desktop: `padding:14px 24px;${BTN_LH}` }, text: c.hero.secondary, link: "#" }),
        ]),
        // The shared `trust` class aligns to the top and sets line-height 1.5; this design centres
        // the row and leaves the line box at `normal` (17px for 14px Inter).
        flex("daycare/hero/trust", { title: "Trust line", classes: ["trust"], css: { desktop: "align-items:center;line-height:17px" } }, [
          icon("daycare/hero/trust/i", "shield-alt", ["icon-18", "icon-teal"], "flex:0 0 auto"),
          text("daycare/hero/trust/t", { title: "Trust", tag: "span", text: c.hero.trust }),
        ]),
      ]),
      block("daycare/hero/media", { title: "Video", classes: ["media-box"], css: { desktop: "height:clamp(320px,42vw,560px)" } }, [
        video("daycare/hero/video", { title: "Hero video", css: { desktop: "width:100%;height:100%;object-fit:cover" }, url: c.hero.video.src }),
        text("daycare/hero/media/credit", { title: "Video credit", tag: "span", classes: ["media-credit"], css: { desktop: CREDIT_LH }, text: c.hero.video.credit }),
      ]),
    ]);

    // --------------------------------------------------------- For families
    const fam = c.families;
    const families = flex("daycare/families", { title: "For families", tag: "section", classes: ["band"] }, [
      grid("daycare/families/wrap", { title: "Wrap", classes: ["sec", "wrap"], css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:64px;align-items:start" } }, [
        flex("daycare/families/intro", { title: "Intro", classes: ["stack-16"] }, [
          plainEyebrow("daycare/families/eyebrow", fam.eyebrow),
          heading("daycare/families/h2", { title: "H2", tag: "h2", css: { desktop: H2_UNBALANCED }, text: fam.title }),
          text("daycare/families/lead", { title: "Lead", classes: ["lead"], text: fam.lead }),
        ]),
        // The design's `.dstep` is byte-for-byte the shared `.card` plus `.card-lift`'s hover, so
        // it reuses both rather than introducing a fourth near-identical card class.
        grid("daycare/families/steps", { title: "Steps", css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:20px" } },
          fam.steps.map((s, i) => flex(`daycare/families/steps/${i}`, { title: s.title, classes: ["card", "card-lift"], interaction: { trigger: "scrollIn", effect: "fade", delayMs: (i % 2) * 80 } }, [
            flex(`daycare/families/steps/${i}/top`, { title: "Top row", classes: ["step-top"] }, [
              flex(`daycare/families/steps/${i}/bubble`, { title: "Icon", classes: ["bubble-tint", "bubble"] }, [
                icon(`daycare/families/steps/${i}/bubble/i`, s.icon, ["icon-22", "icon-teal"]),
              ]),
              text(`daycare/families/steps/${i}/n`, { title: s.n, tag: "span", classes: ["step-pill", "step-num"], text: s.n }),
            ]),
            heading(`daycare/families/steps/${i}/h3`, { title: s.title, tag: "h3", classes: ["h3"], css: { desktop: H3_LH }, text: s.title }),
            text(`daycare/families/steps/${i}/p`, { title: "Text", classes: ["body-15"], text: s.text }),
          ]))),
      ]),
    ]);

    // -------------------------------------------------------- Notification
    const nt = c.notify;
    const notify = grid("daycare/notify", { title: "Notification", tag: "section", classes: ["sec", "wrap"], css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:64px;align-items:center" } }, [
      flex("daycare/notify/col", { title: "Card column", css: { desktop: "justify-content:center" } }, [
        flex("daycare/notify/card", { title: nt.card.title, classes: ["shadow-deep"], css: { desktop: "width:min(100%,440px);flex-direction:column;gap:16px;padding:24px;border-radius:14px;background-color:var(--white);border-width:1.5px;border-style:solid;border-color:var(--line)" } }, [
          flex("daycare/notify/card/head", { title: "Head", classes: ["step-top"] }, [
            flex("daycare/notify/card/chip", { title: nt.card.chip, classes: ["chip-req"], css: { desktop: "display:inline-flex;align-items:center;gap:6px;transform:rotate(-3deg)" } }, [
              // 12px, not the shared icon-18: the design's glyph inherits the chip's own font-size.
              // flex:0 0 auto for the reason in poppynz.md — an e-svg wrapper's min-content size is
              // 0, so it shrinks beside text that would overflow the row.
              icon("daycare/notify/card/chip/i", "bell", ["anim-wiggle"], "flex:0 0 auto;width:12px;height:12px;color:var(--magenta-ink)"),
              text("daycare/notify/card/chip/t", { title: nt.card.chip, tag: "span", text: nt.card.chip }),
            ]),
            text("daycare/notify/card/time", { title: "Time", tag: "span", classes: ["muted-13"], css: { desktop: NUM_LH }, text: nt.card.time }),
          ]),
          heading("daycare/notify/card/h3", { title: nt.card.title, tag: "h3", classes: ["h3-22"], text: nt.card.title }),
          // The design sets the list's font once on the <ul> and lets the rows inherit it.
          flex("daycare/notify/card/list", { title: "Details", css: { desktop: `flex-direction:column;gap:8px;font-family:var(--font-body);font-weight:400;font-size:15px;line-height:19px;color:var(--ink)` } },
            nt.card.rows.map((r, i) => flex(`daycare/notify/card/list/${i}`, { title: r.text, css: { desktop: "gap:10px" } }, [
              icon(`daycare/notify/card/list/${i}/i`, r.icon, ["icon-18", "icon-teal"], "flex:0 0 auto"),
              text(`daycare/notify/card/list/${i}/t`, { title: "Text", tag: "span", text: r.text }),
            ]))),
          // A one-off pill button (the design's inline-styled anchor): close to `getstarted` and
          // `go-sky` but matching neither's padding or size, and used once, so it stays local.
          button("daycare/notify/card/cta", { title: nt.card.cta, css: { desktop: `align-self:flex-start;display:inline-block;padding:11px 20px;border-radius:999px;background-color:var(--sky);color:var(--white);font-family:var(--font-body);font-weight:600;font-size:14px;${BTN_LH_14};text-decoration:none;box-shadow:0 10px 24px -10px rgba(55,181,255,.65)` }, text: nt.card.cta, link: "#" }),
        ]),
      ]),
      flex("daycare/notify/copy", { title: "Copy", classes: ["stack-20"] }, [
        plainEyebrow("daycare/notify/eyebrow", nt.eyebrow),
        heading("daycare/notify/h2", { title: "H2", tag: "h2", css: { desktop: H2_SM_UNBALANCED }, text: nt.title }),
        text("daycare/notify/lead", { title: "Lead", classes: ["lead"], text: nt.lead }),
        text("daycare/notify/note", { title: "Note", classes: ["body-15"], css: { desktop: "line-height:1.6" }, text: nt.note }),
      ]),
    ]);

    // -------------------------------------------------------- For daycares
    const dc = c.daycares;
    // The design anchors the hero's "I run a daycare" button at #daycares; a V4 atomic element
    // renders no `id` attribute, so that button stays inert — see poppynz.md § Named deviations.
    const daycares = flex("daycare/providers", { title: "For daycares", tag: "section", classes: ["sec-x"], css: { desktop: "padding-top:0;padding-bottom:clamp(56px,8vw,96px)" } }, [
      grid("daycare/providers/panel", { title: "Panel", classes: ["wrap", "navy", "shadow-deep"], css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:64px;align-items:center;padding:clamp(32px,5vw,64px);border-radius:14px" } }, [
        flex("daycare/providers/copy", { title: "Copy", classes: ["stack-24"] }, [
          dashEyebrow("daycare/providers/eyebrow", dc.eyebrow, true),
          heading("daycare/providers/h2", { title: "H2", tag: "h2", classes: ["h2-light", "em-accent"], text: dc.title }),
          text("daycare/providers/lead", { title: "Lead", classes: ["lead-light"], css: { desktop: "max-width:520px" }, text: dc.lead }),
          button("daycare/providers/cta", { title: dc.cta, classes: ["btn-primary-14"], css: { desktop: `align-self:flex-start;${BTN_LH_15}` }, text: dc.cta, link: APP.signUp }),
        ]),
        flex("daycare/providers/list", { title: "What you list", css: { desktop: "flex-direction:column;gap:12px" } }, [
          ...dc.rows.map((r, i) => flex(`daycare/providers/list/${i}`, { title: r.text, classes: ["row-dark"] }, [
            text(`daycare/providers/list/${i}/n`, { title: r.n, tag: "span", classes: ["num-light"], css: { desktop: "flex:0 0 auto" }, text: r.n }),
            text(`daycare/providers/list/${i}/t`, { title: "Text", tag: "span", classes: ["row-dark-t"], text: r.text }),
          ])),
          // The last row is the same navy row with its bottom padding dropped so the illustration
          // can sit on the edge. `link-light` styles the inline <a> through the theme's descendant
          // rule: html-v3 keeps `a[href]` but strips every attribute, so the link cannot carry a
          // class of its own. Same mechanism as em-navy / em-ink.
          flex("daycare/providers/help", { title: "Help", classes: ["row-dark"], css: { desktop: "align-items:flex-end;padding-bottom:0;overflow:hidden" } }, [
            image("daycare/providers/help/art", { title: dc.alt, css: { desktop: "flex:0 0 auto;display:block;height:96px;width:auto;margin-bottom:-2px" }, media: "ill:providers.webp", alt: "" }),
            text("daycare/providers/help/t", { title: "Text", tag: "span", classes: ["body-15-light", "link-light"], css: { desktop: "line-height:1.5;padding-top:14px;padding-bottom:14px" }, text: dc.help }),
          ]),
        ]),
      ]),
    ]);

    // ------------------------------------------------------------ Final CTA
    // `cta-inner` carries the section padding and no max-width, which is right for Home but not
    // here: this design caps the inner column at 720px, so the padding stays on the section.
    // Built locally for that reason, as on For helpers and Safety & trust.
    const cta = flex("daycare/cta", { title: "Final CTA", tag: "section", classes: ["band-top"], css: { desktop: "padding:clamp(56px,8vw,96px) clamp(24px,5vw,96px)" } }, [
      flex("daycare/cta/inner", { title: "Inner", css: { desktop: "flex-direction:column;align-items:center;gap:24px;text-align:center;width:100%;max-width:720px;margin-left:auto;margin-right:auto" } }, [
        heading("daycare/cta/h2", { title: "H2", tag: "h2", css: { desktop: H2_CTA_UNBALANCED }, text: c.cta.title }),
        text("daycare/cta/p", { title: "Text", classes: ["body-18"], text: c.cta.text }),
        flex("daycare/cta/btns", { title: "Buttons", classes: ["btn-row-center"] }, [
          button("daycare/cta/primary", { title: c.cta.primary, classes: ["btn-primary"], css: { desktop: BTN_LH }, text: c.cta.primary, link: APP.signUp }),
          button("daycare/cta/secondary", { title: c.cta.secondary, classes: ["btn-outline"], css: { desktop: BTN_LH }, text: c.cta.secondary, link: APP.signUp }),
        ]),
      ]),
    ]);

    return [hero, families, notify, daycares, cta];
  },
};
