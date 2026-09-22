import { SAFETY } from "../content/safety";
import { block, button, flex, grid, heading, image, svg, text, type Recipe } from "../dsl";
import { APP } from "../pages";

// The kit sets the body line-height in `em`, which every descendant inherits as a FIXED 19.2px
// instead of re-resolving against its own font-size (see poppynz.md § "the kit's body line-height").
// Shared classes are left alone so the pages already live do not move; every element this page owns
// that the kit would mis-size carries the design's own measured line box locally instead.
const EYEBROW_LH = "line-height:15px"; // 12px Inter
const H3_LH = "line-height:27px";      // 21px Hanken Grotesk
const CHIP_LH = "line-height:15px";    // 12px Inter
const BTN_LH = "line-height:20px";     // 16px Inter

const icon = (path: string, name: string, cls: string[], desktopCss?: string) =>
  svg(path, { title: name, classes: cls, icon: `icon:${name}`, ...(desktopCss ? { css: { desktop: desktopCss } } : {}) });

// Eyebrow with the animated dash, as on Home, For families and For helpers. This design uses the
// dashed variant in the Hero and the navy Human-review band, and the plain one everywhere else.
const dashEyebrow = (path: string, label: string, light = false) =>
  flex(path, { title: "Eyebrow", classes: [light ? "eyebrow-light" : "eyebrow"], css: { desktop: EYEBROW_LH } }, [
    block(`${path}/dash`, { title: "Dash", classes: ["dash", "anim-wiggle"] }, []),
    text(`${path}/label`, { title: label, tag: "span", text: label }),
  ]);

const plainEyebrow = (path: string, label: string) =>
  text(path, { title: "Eyebrow", classes: ["eyebrow"], css: { desktop: EYEBROW_LH }, text: label });

export const safetyRecipe: Recipe = {
  kind: "page", key: "safety",
  build(lang, media) {
    const c = SAFETY[lang];
    for (const n of ["star", "heart", "check", "check-circle", "id-card", "user-shield", "file-alt", "first-aid", "graduation-cap", "lock", "balance-scale", "envelope-open-text", "eye-slash", "times-circle"]) media.icon(n);
    for (const card of c.checks.cards) media.add(`ill:${card.file}`, `../../design/assets/illustrations/${card.file}`, card.title);

    // ---------------------------------------------------------------- Hero
    // The shared `hero` class with two local overrides: this design's columns break at 440px
    // (not 460) and its vertical padding tops out at 88px (not 80). A local style always beats a
    // global class, so neither override disturbs the other heroes.
    const card = c.hero.card;
    const hero = flex("safety/hero", { title: "Hero", tag: "section", classes: ["hero"], css: { desktop: "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));padding:clamp(48px,7vw,88px) clamp(24px,5vw,96px)" } }, [
      block("safety/hero/deco", { title: "Decorations", classes: ["deco"] }, [
        block("safety/hero/deco/1", { title: "Dot", classes: ["deco-d1", "anim-drift"] }, []),
        block("safety/hero/deco/2", { title: "Dot", classes: ["deco-d2", "anim-drift-rev"] }, []),
        icon("safety/hero/deco/3", "star", ["deco-d3", "anim-twinkle"]),
        block("safety/hero/deco/4", { title: "Ring", classes: ["deco-d4", "anim-drift-slow"] }, []),
        icon("safety/hero/deco/5", "heart", ["deco-d5", "anim-bob"]),
      ]),
      flex("safety/hero/copy", { title: "Copy", classes: ["hero-copy"], css: { desktop: "gap:24px" }, interaction: { trigger: "load", effect: "slide", direction: "bottom", durationMs: 700 } }, [
        dashEyebrow("safety/hero/eyebrow", c.hero.eyebrow),
        // The `h1` class carries the theme's text-wrap:balance; only the size differs here.
        heading("safety/hero/h1", { title: "H1", tag: "h1", classes: ["h1"], css: { desktop: "font-size:clamp(38px,4.6vw,60px)" }, text: c.hero.title }),
        text("safety/hero/lead", { title: "Lead", classes: ["lead-lg"], css: { desktop: "max-width:560px" }, text: c.hero.lead }),
        // The design anchors these five pills at #helpers, #families, #admin, #data and #never.
        // A V4 atomic element renders no `id` attribute (only data-id and its class list), so
        // there is nothing to anchor to and they stay inert, exactly as the For families and
        // For helpers hero secondary CTAs do. See poppynz.md § Named deviations.
        flex("safety/hero/nav", { title: "Section pills", css: { desktop: "flex-wrap:wrap;gap:10px" } },
          c.hero.nav.map((t, i) => button(`safety/hero/nav/${i}`, { title: t, classes: ["pill-nav"], text: t, link: "#" }))),
      ]),
      flex("safety/hero/col", { title: "Card column", css: { desktop: "justify-content:center" } }, [
        flex("safety/hero/card", { title: card.label, classes: ["shadow-deep"], css: { desktop: "width:min(100%,420px);flex-direction:column;gap:14px;padding:24px;border-radius:14px;background-color:var(--white);border-width:1.5px;border-style:solid;border-color:var(--line)" } }, [
          flex("safety/hero/card/head", { title: "Head", classes: ["step-top"] }, [
            text("safety/hero/card/head/l", { title: card.label, tag: "span", classes: ["label"], css: { desktop: EYEBROW_LH }, text: card.label }),
            flex("safety/hero/card/head/v", { title: card.vetted, classes: ["vetted"], css: { desktop: CHIP_LH }, interaction: { trigger: "load", effect: "scale", delayMs: 400 } }, [
              // 12px, not the shared icon-18: the design's glyph inherits the badge's own 12px
              // font-size. flex:0 0 auto for the reason in poppynz.md — an e-svg wrapper's
              // min-content size is 0, so it shrinks beside text that overflows the row.
              icon("safety/hero/card/head/v/i", "check-circle", ["icon-ok"], "flex:0 0 auto;width:12px;height:12px"),
              text("safety/hero/card/head/v/t", { title: card.vetted, tag: "span", text: card.vetted }),
            ]),
          ]),
          ...card.rows.map((row, i) => flex(`safety/hero/card/${i}`, { title: row.label, classes: ["row-item"], css: { desktop: "background-color:var(--page)" } }, [
            flex(`safety/hero/card/${i}/l`, { title: "Label", classes: ["row-lbl"], css: { desktop: "min-width:0" } }, [
              icon(`safety/hero/card/${i}/i`, row.icon, ["icon-20", "icon-teal"], "flex:0 0 auto"),
              text(`safety/hero/card/${i}/t`, { title: row.label, tag: "span", text: row.label }),
            ]),
            // The design pins these pills with white-space:nowrap, which is not in the 4.2.4
            // converter's property list at all; flex:0 0 auto is what actually keeps them at their
            // own width, which is the failure mode nowrap was guarding against.
            text(`safety/hero/card/${i}/c`, { title: row.chip, tag: "span", classes: [row.kind === "ok" ? "chip-ok" : "chip-info"], css: { desktop: "flex:0 0 auto" }, text: row.chip }),
          ])),
          text("safety/hero/card/note", { title: "Note", classes: ["muted-13"], text: card.note }),
        ]),
      ]),
    ]);

    // -------------------------------------------------------- Helper checks
    const checks = flex("safety/checks", { title: "Helper checks", tag: "section", classes: ["band"] }, [
      flex("safety/checks/wrap", { title: "Wrap", classes: ["sec", "wrap", "stack-40"] }, [
        flex("safety/checks/intro", { title: "Intro", classes: ["stack-16"], css: { desktop: "max-width:760px" } }, [
          plainEyebrow("safety/checks/eyebrow", c.checks.eyebrow),
          heading("safety/checks/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.checks.title }),
        ]),
        grid("safety/checks/cards", { title: "Check cards", classes: ["grid-cards"] },
          c.checks.cards.map((card, i) => flex(`safety/checks/cards/${i}`, { title: card.title, classes: ["art-card", i % 2 === 0 ? "tint-blue" : "tint-pink"], interaction: { trigger: "scrollIn", effect: "fade", delayMs: (i % 3) * 80 } }, [
            flex(`safety/checks/cards/${i}/top`, { title: "Top row", classes: ["step-top"] }, [
              text(`safety/checks/cards/${i}/chip`, { title: card.chip, tag: "span", classes: [card.kind === "req" ? "chip-req" : "chip-info"], text: card.chip }),
            ]),
            heading(`safety/checks/cards/${i}/h3`, { title: card.title, tag: "h3", classes: ["h3"], css: { desktop: H3_LH }, text: card.title }),
            // em-ink styles the inline <strong> lead-in through the theme's descendant rule:
            // html-v3 strips attributes, so the design's `<strong style="color:#001E30">` cannot
            // carry its own class. Same mechanism as em-navy on For families.
            text(`safety/checks/cards/${i}/what`, { title: "What it is", classes: ["body-15", "em-ink"], text: card.what }),
            text(`safety/checks/cards/${i}/why`, { title: "Why we ask", classes: ["body-15", "em-ink"], text: card.why }),
            image(`safety/checks/cards/${i}/art`, { title: "Illustration", classes: ["art"], media: `ill:${card.file}`, alt: "" }),
          ]))),
      ]),
    ]);

    // ----------------------------------------------------------- Credibled
    const credibled = flex("safety/credibled", { title: "Credibled", tag: "section", classes: ["sec", "wrap"] }, [
      grid("safety/credibled/panel", { title: "Panel", classes: ["grid-2"], css: { desktop: "padding:clamp(28px,4vw,48px);border-radius:14px;background-color:var(--orange-bg);border-width:1.5px;border-style:solid;border-color:var(--orange-line)" } }, [
        flex("safety/credibled/copy", { title: "Copy", css: { desktop: "flex-direction:column;gap:18px" } }, [
          flex("safety/credibled/head", { title: "Head", css: { desktop: "align-items:center;gap:10px" } }, [
            // The shared `dot` is the Credibled strip's own 10px dot; this one is 12px, so it
            // reuses the class and overrides the two sizes locally.
            block("safety/credibled/head/dot", { title: "Dot", classes: ["dot"], css: { desktop: "width:12px;height:12px" } }, []),
            // The design's `.eyebrow-dark` is `.eyebrow` in ink instead of teal, and it appears
            // exactly once on this page, so it is a local override rather than a global class.
            text("safety/credibled/head/t", { title: c.credibled.eyebrow, tag: "span", classes: ["eyebrow"], css: { desktop: `color:var(--ink);${EYEBROW_LH}` }, text: c.credibled.eyebrow }),
          ]),
          heading("safety/credibled/h2", { title: "H2", tag: "h2", classes: ["h2-sm"], text: c.credibled.title }),
          text("safety/credibled/lead", { title: "Lead", classes: ["lead"], text: c.credibled.lead }),
        ]),
        flex("safety/credibled/list", { title: "Points", css: { desktop: "flex-direction:column;gap:12px" } },
          c.credibled.points.map((t, i) => flex(`safety/credibled/list/${i}`, { title: `Point ${i + 1}`, classes: ["credibled-row"] }, [
            icon(`safety/credibled/list/${i}/i`, "check", ["icon-20", "icon-orange"], "flex:0 0 auto;margin-top:1px"),
            text(`safety/credibled/list/${i}/t`, { title: "Text", tag: "span", text: t }),
          ]))),
      ]),
    ]);

    // -------------------------------------------------------- Human review
    const rv = c.review;
    const review = flex("safety/review", { title: "Human review", tag: "section", classes: ["navy"] }, [
      grid("safety/review/wrap", { title: "Wrap", classes: ["sec", "wrap", "grid-2"] }, [
        flex("safety/review/copy", { title: "Copy", classes: ["stack-20"] }, [
          dashEyebrow("safety/review/eyebrow", rv.eyebrow, true),
          heading("safety/review/h2", { title: "H2", tag: "h2", classes: ["h2-light", "em-accent"], text: `${rv.title} <em>${rv.titleAccent}</em>` }),
          text("safety/review/lead1", { title: "Lead", classes: ["lead-light"], css: { desktop: "max-width:560px" }, text: rv.lead1 }),
          text("safety/review/lead2", { title: "Lead", classes: ["lead-light"], css: { desktop: "max-width:560px" }, text: rv.lead2 }),
        ]),
        flex("safety/review/steps", { title: "Steps", css: { desktop: "flex-direction:column;gap:12px" } },
          rv.steps.map((s, i) => flex(`safety/review/steps/${i}`, { title: s.title, classes: ["row-dark"], css: { desktop: "align-items:flex-start" } }, [
            text(`safety/review/steps/${i}/n`, { title: s.n, tag: "span", classes: ["num-light"], css: { desktop: "flex:0 0 auto;margin-top:3px" }, text: s.n }),
            flex(`safety/review/steps/${i}/lines`, { title: "Lines", classes: ["stack-4"] }, [
              text(`safety/review/steps/${i}/t`, { title: s.title, tag: "span", classes: ["row-dark-title"], text: s.title }),
              text(`safety/review/steps/${i}/d`, { title: "Text", tag: "span", classes: ["row-dark-desc"], text: s.text }),
            ]),
          ]))),
      ]),
    ]);

    // -------------------------------------------------- Two-way verification
    const fam = c.families;
    const families = grid("safety/families", { title: "Two-way verification", tag: "section", classes: ["sec", "wrap", "grid-2"] }, [
      // A CSS background rather than an e-image, like Home's two photos: the source is a hotlinked
      // Unsplash URL, not a media-library file, so it carries no alt text (named deviation; the
      // design's alt lives in the editor title instead).
      block("safety/families/photo", { title: fam.alt, classes: ["card-shadow"], css: { desktop: "position:relative;height:clamp(300px,36vw,480px);border-radius:14px;overflow:hidden;background-color:var(--tint);background-image:url(https://images.unsplash.com/photo-1504151932400-72d4384f04b3?auto=format&fit=crop&w=1200&q=80);background-size:cover;background-position:center" } }, [
        text("safety/families/photo/credit", { title: "Photo credit", tag: "span", classes: ["photo-credit"], text: fam.credit }),
      ]),
      flex("safety/families/copy", { title: "Copy", classes: ["stack-20"] }, [
        plainEyebrow("safety/families/eyebrow", fam.eyebrow),
        heading("safety/families/h2", { title: "H2", tag: "h2", classes: ["h2"], text: fam.title }),
        text("safety/families/lead", { title: "Lead", classes: ["lead"], text: fam.lead }),
        // The shared `checks` class sets the muted grey Home uses; this design's list inherits the
        // body ink. Overridden locally so Home and For families do not move — see poppynz.md
        // § "Also found, shared-class, left alone".
        flex("safety/families/checks", { title: "Checks", classes: ["checks"], css: { desktop: "color:var(--ink)" } },
          fam.checks.map((t, i) => flex(`safety/families/checks/${i}`, { title: `Item ${i + 1}`, classes: ["check-row"] }, [
            // margin-top:2px is the design's `.checks-top i`, a descendant rule with no V4
            // equivalent; flex:0 0 auto stops the e-svg wrapper shrinking beside the text.
            icon(`safety/families/checks/${i}/i`, "check", ["icon-18", "icon-ok"], "flex:0 0 auto;margin-top:2px"),
            text(`safety/families/checks/${i}/t`, { title: "Text", tag: "span", text: t }),
          ]))),
      ]),
    ]);

    // ----------------------------------------------------------- Your data
    const data = flex("safety/data", { title: "Your data", tag: "section", classes: ["band"] }, [
      flex("safety/data/wrap", { title: "Wrap", classes: ["sec", "wrap", "stack-40"] }, [
        flex("safety/data/intro", { title: "Intro", classes: ["stack-16"], css: { desktop: "max-width:760px" } }, [
          plainEyebrow("safety/data/eyebrow", c.data.eyebrow),
          heading("safety/data/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.data.title }),
        ]),
        grid("safety/data/cards", { title: "Privacy cards", classes: ["grid-cards"] },
          c.data.cards.map((d, i) => flex(`safety/data/cards/${i}`, { title: d.title, classes: ["card"], interaction: { trigger: "scrollIn", effect: "fade", delayMs: (i % 3) * 80 } }, [
            flex(`safety/data/cards/${i}/bubble`, { title: "Icon", classes: ["bubble-tint", "bubble"] }, [
              icon(`safety/data/cards/${i}/bubble/i`, d.icon, ["icon-22", "icon-teal"]),
            ]),
            heading(`safety/data/cards/${i}/h3`, { title: d.title, tag: "h3", classes: ["h3"], css: { desktop: H3_LH }, text: d.title }),
            text(`safety/data/cards/${i}/p`, { title: "Text", classes: ["body-15"], text: d.text }),
          ]))),
      ]),
    ]);

    // ---------------------------------------------------- What we never do
    const never = grid("safety/never", { title: "What we never do", tag: "section", classes: ["sec", "wrap"], css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:clamp(32px,5vw,64px);align-items:start" } }, [
      flex("safety/never/head", { title: "Head", classes: ["stack-16"] }, [
        plainEyebrow("safety/never/eyebrow", c.never.eyebrow),
        // Deliberately NOT the `h2` class: the design opts this one heading out of balanced
        // wrapping (`text-wrap:initial`), and the theme applies text-wrap:balance to `.h2`.
        heading("safety/never/h2", { title: "H2", tag: "h2", css: { desktop: "font-family:var(--font-display);font-weight:800;font-size:clamp(30px,3.6vw,44px);line-height:1.1;letter-spacing:-.02em;color:var(--navy)" }, text: c.never.title }),
      ]),
      // grid-column:span 2 puts the list across the two remaining columns of the 3-column auto-fit
      // grid; on mobile the grid collapses to one column, where a span of 2 would create an
      // implicit second column and overflow the viewport (the design's own list does).
      flex("safety/never/list", { title: "Promises", css: { desktop: "flex-direction:column;gap:10px;grid-column:span 2", mobile: "grid-column:span 1" } },
        c.never.items.map((t, i) => flex(`safety/never/list/${i}`, { title: `Item ${i + 1}`, classes: ["never-row"] }, [
          icon(`safety/never/list/${i}/i`, "times-circle", ["icon-22", "icon-danger"], "flex:0 0 auto"),
          text(`safety/never/list/${i}/t`, { title: "Text", tag: "span", text: t }),
        ]))),
    ]);

    // ------------------------------------------------------------ Final CTA
    // `cta-inner` carries the section padding and no max-width, which is right for Home but not
    // here: this design caps the inner column at 680px, so the padding has to stay on the section
    // or the cap would swallow it. Built locally for that reason, as on For helpers.
    const cta = flex("safety/cta", { title: "Final CTA", tag: "section", classes: ["band-top"], css: { desktop: "padding:clamp(56px,8vw,96px) clamp(24px,5vw,96px)" } }, [
      flex("safety/cta/inner", { title: "Inner", css: { desktop: "flex-direction:column;align-items:center;gap:24px;text-align:center;width:100%;max-width:680px;margin-left:auto;margin-right:auto" } }, [
        heading("safety/cta/h2", { title: "H2", tag: "h2", classes: ["h2-cta"], text: c.cta.title }),
        text("safety/cta/p", { title: "Text", classes: ["body-18"], text: c.cta.text }),
        flex("safety/cta/btns", { title: "Buttons", classes: ["btn-row-center"] }, [
          button("safety/cta/primary", { title: c.cta.primary, classes: ["btn-primary"], css: { desktop: BTN_LH }, text: c.cta.primary, link: APP.signUp }),
          button("safety/cta/secondary", { title: c.cta.secondary, classes: ["btn-outline"], css: { desktop: BTN_LH }, text: c.cta.secondary, link: "mailto:support@poppynz.com" }),
        ]),
      ]),
    ]);

    return [hero, checks, credibled, review, families, data, never, cta];
  },
};
