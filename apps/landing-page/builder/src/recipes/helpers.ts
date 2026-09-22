import { HELPERS } from "../content/helpers";
import { block, button, flex, grid, heading, image, svg, text, video, type Recipe } from "../dsl";
import { APP } from "../pages";

// The kit sets the body line-height in `em`, which every descendant inherits as a FIXED 19.2px
// instead of re-resolving against its own font-size (see poppynz.md § "the kit's body line-height").
// Shared classes are left alone so Home and For families do not move; every element this page owns
// that the kit would mis-size carries the design's own measured line box locally instead.
const EYEBROW_LH = "line-height:15px";   // 12px Inter
const H3_LH = "line-height:27px";        // 21px Hanken Grotesk
const BTN_LH = "line-height:20px";       // 16px Inter
const PRICE_LH = "line-height:19px";     // 15px Inter

const icon = (path: string, name: string, cls: string[], desktopCss?: string) =>
  svg(path, { title: name, classes: cls, icon: `icon:${name}`, ...(desktopCss ? { css: { desktop: desktopCss } } : {}) });

// Eyebrow with the animated dash, as on Home and For families. The design uses the dashed variant
// in the Hero and Major-domo bands and the plain one everywhere else.
const dashEyebrow = (path: string, label: string, light = false) =>
  flex(path, { title: "Eyebrow", classes: [light ? "eyebrow-light" : "eyebrow"], css: { desktop: EYEBROW_LH } }, [
    block(`${path}/dash`, { title: "Dash", classes: ["dash", "anim-wiggle"] }, []),
    text(`${path}/label`, { title: label, tag: "span", text: label }),
  ]);

// A <strong>-led checklist row. `em-navy` goes on the LIST (the theme rule is a descendant
// selector), the design's ink colour is restored there too — the shared `checks` class sets the
// muted grey that Home uses. See poppynz.md § "Also found, shared-class, left alone".
const checkRow = (path: string, t: string, i: number, glyph: "check" | "plus") =>
  flex(`${path}/${i}`, { title: `Item ${i + 1}`, classes: ["check-row"] }, [
    // flex:0 0 auto is required: an e-svg wrapper's min-content size is 0, so as an ordinary
    // flex item it shrinks when the (much wider) max-content text overflows the row — the design's
    // <i> is a font glyph whose min-content size is the glyph itself, so it never shrinks.
    icon(`${path}/${i}/i`, glyph, ["icon-18", glyph === "check" ? "icon-ok" : "icon-teal"], "flex:0 0 auto;margin-top:2px"),
    text(`${path}/${i}/t`, { title: "Text", tag: "span", text: t }),
  ]);

export const helpersRecipe: Recipe = {
  kind: "page", key: "helpers",
  build(lang, media) {
    const c = HELPERS[lang];
    for (const n of ["star", "heart", "check", "plus", "minus", "pen", "arrow-right", "user-edit", "file-upload", "user-shield", "check-circle"]) media.icon(n);
    for (const card of c.why.cards) media.add(`ill:${card.file}`, `../../design/assets/illustrations/${card.file}`, card.title);
    media.add("ill:work-anywhere.svg", "../../design/assets/illustrations/work-anywhere.svg", c.major.titleAccent);
    for (const row of c.rates.panel.rows) media.add(`svc:${row.file}`, `../../design/assets/services/${row.file}.webp`, row.name);

    // ---------------------------------------------------------------- Hero
    // Full-bleed two-column grid: a navy copy column carrying its own padding, and a video column.
    // Deliberately NOT the shared `hero` class, which adds the page-level padding and 1920px cap
    // this design's hero does not have.
    const q = c.hero.quote;
    const hero = grid("helpers/hero", { title: "Hero", tag: "section", css: { desktop: "position:relative;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:0;min-height:560px" } }, [
      block("helpers/hero/deco", { title: "Decorations", classes: ["deco"] }, [
        block("helpers/hero/deco/1", { title: "Dot", classes: ["deco-d1", "anim-drift"] }, []),
        block("helpers/hero/deco/2", { title: "Dot", classes: ["deco-d2", "anim-drift-rev"] }, []),
        icon("helpers/hero/deco/3", "star", ["deco-d3", "anim-twinkle"]),
        block("helpers/hero/deco/4", { title: "Ring", classes: ["deco-d4", "anim-drift-slow"] }, []),
        icon("helpers/hero/deco/5", "heart", ["deco-d5", "anim-bob"]),
      ]),
      flex("helpers/hero/copy", { title: "Copy", classes: ["hero-copy", "navy"], css: { desktop: "justify-content:space-between;padding:clamp(40px,5vw,56px) clamp(24px,5vw,96px)" }, interaction: { trigger: "load", effect: "slide", direction: "bottom", durationMs: 700 } }, [
        flex("helpers/hero/head", { title: "Head", classes: ["stack-24"] }, [
          dashEyebrow("helpers/hero/eyebrow", c.hero.eyebrow, true),
          // The `h1` class carries the theme's text-wrap:balance; weight, size, line-height and
          // colour all differ from Home's hero, and a local style always wins over a global class
          // (local-*.css is enqueued after global-*.css at the same specificity).
          heading("helpers/hero/h1", { title: "H1", tag: "h1", classes: ["h1", "em-accent"], css: { desktop: `font-weight:700;font-size:clamp(38px,4.6vw,60px);line-height:1.08;color:var(--white)` }, text: `${c.hero.title} <em>${c.hero.titleAccent}</em> ${c.hero.titleTail}` }),
          text("helpers/hero/lead", { title: "Lead", classes: ["lead-light"], css: { desktop: "line-height:1.65;max-width:480px" }, text: c.hero.lead }),
          flex("helpers/hero/btns", { title: "Buttons", classes: ["btn-row"] }, [
            button("helpers/hero/cta1", { title: c.hero.ctaPrimary, classes: ["btn-primary-15"], css: { desktop: BTN_LH }, text: c.hero.ctaPrimary, link: APP.signUp }),
            // The design anchors this at the in-page #documents section. A V4 atomic element
            // renders no `id` attribute (only data-id and its class list), so there is nothing to
            // anchor to; this keeps the design's own placeholder convention. See poppynz.md.
            // btn-ghost-light is a one-off size, so it is local css rather than a global class;
            // background-color:transparent is required or the e-button base style's blue shows.
            button("helpers/hero/cta2", { title: c.hero.ctaSecondary, css: { desktop: "display:inline-block;padding:14px 24px;border-radius:8px;border-width:1.5px;border-style:solid;border-color:rgba(255,255,255,.35);color:var(--white);background-color:transparent;font-family:var(--font-body);font-weight:600;font-size:16px;line-height:20px;text-decoration:none", "desktop:hover": "background-color:rgba(255,255,255,.08);color:var(--white)" }, text: c.hero.ctaSecondary, link: "#" }),
          ]),
        ]),
        // The design's <blockquote>; `blockquote` is not a valid V4 container tag, so it is a div.
        // Only the top border is real, so the other three sides need an explicit 0 — an untouched
        // side falls back to the browser default `medium` (3px). See pitfalls.md.
        flex("helpers/hero/quote", { title: "Quote", css: { desktop: "flex-direction:column;gap:14px;max-width:460px;padding-top:24px;padding-right:0;padding-bottom:0;padding-left:0;border-top-width:1px;border-right-width:0;border-bottom-width:0;border-left-width:0;border-style:solid;border-color:rgba(255,255,255,.15)" } }, [
          text("helpers/hero/quote/t", { title: "Quote", css: { desktop: "font-family:var(--font-display);font-weight:500;font-style:italic;font-size:20px;line-height:1.5;color:var(--tint-2)" }, text: q.text }),
          flex("helpers/hero/quote/who", { title: "Attribution", tag: "footer", css: { desktop: "align-items:center;gap:12px" } }, [
            text("helpers/hero/quote/who/a", { title: q.initial, tag: "span", classes: ["avatar"], css: { desktop: "line-height:17px" }, text: q.initial }),
            text("helpers/hero/quote/who/t", { title: q.who, tag: "span", css: { desktop: "font-family:var(--font-body);font-weight:400;font-size:14px;line-height:17px;color:var(--navy-text)" }, text: q.who }),
          ]),
        ]),
      ]),
      block("helpers/hero/col", { title: "Video column", css: { desktop: "min-height:320px" } }, [
        block("helpers/hero/media", { title: "Video", css: { desktop: "position:relative;width:100%;height:100%;background-color:var(--tint)" } }, [
          // No poster: video() takes a media-library key, and the design's poster is a hotlinked
          // Pexels still. Same named deviation as Home's hero. See poppynz.md.
          video("helpers/hero/video", { title: "Hero video", css: { desktop: "display:block;width:100%;height:100%;object-fit:cover" }, url: c.hero.video.src }),
          // media-credit is a shared class whose line-height comes from the kit (19.2px); the
          // design's is the 11px font's own 14px line box. Overridden locally, along with the
          // link decoration and hover colour, so Home's own credit spans are untouched.
          flex("helpers/hero/media/credit", { title: c.hero.video.credit, tag: "a", classes: ["media-credit"], link: c.hero.video.creditUrl, blank: true, css: { desktop: "line-height:14px;text-decoration:none", "desktop:hover": "color:var(--white)" } }, [
            text("helpers/hero/media/credit/t", { title: "Credit", tag: "span", text: c.hero.video.credit }),
          ]),
        ]),
      ]),
    ]);

    // ------------------------------------------------------------ Why join
    const why = flex("helpers/why", { title: "Why join", tag: "section", classes: ["sec", "wrap", "stack-40"] }, [
      flex("helpers/why/intro", { title: "Intro", classes: ["stack-16"], css: { desktop: "max-width:720px" } }, [
        text("helpers/why/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], css: { desktop: EYEBROW_LH }, text: c.why.eyebrow }),
        heading("helpers/why/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.why.title }),
      ]),
      grid("helpers/why/cards", { title: "Benefit cards", css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:20px" } },
        c.why.cards.map((card, i) => flex(`helpers/why/cards/${i}`, { title: card.title, classes: ["art-card", i % 2 === 0 ? "tint-blue" : "tint-pink", "card-shadow"], interaction: { trigger: "scrollIn", effect: "fade", delayMs: i * 80 } }, [
          heading(`helpers/why/cards/${i}/h3`, { title: card.title, tag: "h3", classes: ["h3"], css: { desktop: H3_LH }, text: card.title }),
          text(`helpers/why/cards/${i}/p`, { title: "Text", classes: ["body-15"], text: card.text }),
          image(`helpers/why/cards/${i}/art`, { title: "Illustration", classes: ["art"], media: `ill:${card.file}`, alt: "" }),
        ]))),
    ]);

    // -------------------------------------------------------- Set your rates
    const panel = c.rates.panel;
    const rates = flex("helpers/rates", { title: "Set your rates", tag: "section", classes: ["band"] }, [
      grid("helpers/rates/wrap", { title: "Wrap", classes: ["sec", "wrap", "grid-2"] }, [
        flex("helpers/rates/copy", { title: "Copy", classes: ["stack-20"] }, [
          text("helpers/rates/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], css: { desktop: EYEBROW_LH }, text: c.rates.eyebrow }),
          heading("helpers/rates/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.rates.title }),
          text("helpers/rates/lead1", { title: "Lead", classes: ["lead"], text: c.rates.lead1 }),
          text("helpers/rates/lead2", { title: "Lead", classes: ["lead"], text: c.rates.lead2 }),
        ]),
        // justify-self is not convertible in 4.2.4; auto side margins centre the card in its cell.
        flex("helpers/rates/card", { title: "Your services", css: { desktop: "width:min(100%,440px);margin-left:auto;margin-right:auto;flex-direction:column;gap:12px;padding:24px;border-radius:14px;background-color:var(--page);border-width:1.5px;border-style:solid;border-color:var(--line)" } }, [
          text("helpers/rates/card/label", { title: "Label", tag: "span", classes: ["label"], css: { desktop: EYEBROW_LH }, text: panel.label }),
          ...panel.rows.map((row, i) => flex(`helpers/rates/card/${i}`, { title: row.name, classes: ["row-item"] }, [
            flex(`helpers/rates/card/${i}/l`, { title: "Label", classes: ["row-lbl"] }, [
              block(`helpers/rates/card/${i}/thumb`, { title: "Thumbnail", classes: ["thumb"] }, [
                image(`helpers/rates/card/${i}/img`, { title: row.name, classes: ["thumb-img"], media: `svc:${row.file}`, alt: "" }),
              ]),
              text(`helpers/rates/card/${i}/t`, { title: row.name, tag: "span", text: row.name }),
            ]),
            text(`helpers/rates/card/${i}/r`, { title: "Rate", tag: "span", classes: ["rate"], text: row.rate }),
          ])),
          // The custom-service row: same row, dashed and muted, with a pen glyph instead of a
          // thumbnail and an unfilled rate pill.
          flex("helpers/rates/card/custom", { title: panel.custom.name, classes: ["row-item"], css: { desktop: "border-style:dashed;border-color:var(--line-2)" } }, [
            flex("helpers/rates/card/custom/l", { title: "Label", classes: ["row-lbl"], css: { desktop: "color:var(--muted)" } }, [
              // flex:0 0 auto for the same reason as the checklist glyphs: at narrow widths the
              // label text's max-content size overflows the row and would otherwise shrink the icon.
              icon("helpers/rates/card/custom/i", "pen", ["icon-20", "icon-teal"], "flex:0 0 auto"),
              text("helpers/rates/card/custom/t", { title: panel.custom.name, tag: "span", text: panel.custom.name }),
            ]),
            text("helpers/rates/card/custom/r", { title: "Rate", tag: "span", classes: ["rate"], css: { desktop: "display:block;background-color:transparent" }, text: panel.custom.rate }),
          ]),
          flex("helpers/rates/card/add", { title: panel.add, tag: "button", css: { desktop: "display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border-radius:8px;border-width:1.5px;border-style:solid;border-color:var(--navy);background-color:transparent;color:var(--navy);font-family:var(--font-body);font-weight:600;font-size:14px;line-height:17px;cursor:pointer", "desktop:hover": "background-color:var(--tint-2)" } }, [
            // 14px, not the shared icon-18: the design's glyph inherits the button's own 14px
            // font-size, and an 18px icon would make the row a pixel taller than the design's 43.
            icon("helpers/rates/card/add/i", "plus", [], "flex:0 0 auto;width:14px;height:14px;color:var(--navy)"),
            text("helpers/rates/card/add/t", { title: panel.add, tag: "span", text: panel.add }),
          ]),
        ]),
      ]),
    ]);

    // ----------------------------------------------------------- Onboarding
    const ob = c.onboarding;
    const onboarding = flex("helpers/onboarding", { title: "Onboarding", tag: "section", classes: ["sec", "wrap", "stack-40"] }, [
      flex("helpers/onboarding/intro", { title: "Intro", classes: ["stack-16"], css: { desktop: "max-width:720px" } }, [
        text("helpers/onboarding/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], css: { desktop: EYEBROW_LH }, text: ob.eyebrow }),
        heading("helpers/onboarding/h2", { title: "H2", tag: "h2", classes: ["h2"], text: ob.title }),
      ]),
      grid("helpers/onboarding/steps", { title: "Steps", classes: ["grid-cards"] },
        ob.steps.map((s, i) => flex(`helpers/onboarding/steps/${i}`, { title: s.title, classes: ["card-white"], interaction: { trigger: "scrollIn", effect: "fade", delayMs: i * 80 } }, [
          flex(`helpers/onboarding/steps/${i}/top`, { title: "Top row", classes: ["step-top"] }, [
            flex(`helpers/onboarding/steps/${i}/bubble`, { title: "Icon", classes: ["bubble-tint", "bubble"] }, [
              icon(`helpers/onboarding/steps/${i}/bubble/i`, s.icon, ["icon-22", "icon-teal"]),
            ]),
            // Only the "Approved" pill is a one-off colourway, so it carries the chip declarations
            // locally rather than as a third global class used once.
            text(`helpers/onboarding/steps/${i}/chip`, {
              title: s.chip, tag: "span",
              ...(i === 3
                ? { css: { desktop: "padding:4px 8px;border-radius:4px;background-color:var(--ok-bg);color:var(--ok);font-family:var(--font-body);font-weight:600;font-size:12px;line-height:15px" } }
                : { classes: [i === 2 ? "chip-req" : "chip-info"] }),
              text: s.chip,
            }),
          ]),
          heading(`helpers/onboarding/steps/${i}/h3`, { title: s.title, tag: "h3", classes: ["h3"], css: { desktop: H3_LH }, text: s.title }),
          text(`helpers/onboarding/steps/${i}/p`, { title: "Text", classes: ["body-15"], text: s.text }),
        ]))),
      grid("helpers/onboarding/docs", { title: "Documents", css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:20px" } }, [
        flex("helpers/onboarding/req", { title: ob.required.title, classes: ["doc-panel", "card-shadow", "stack-16"] }, [
          flex("helpers/onboarding/req/head", { title: "Head", css: { desktop: "align-items:center;gap:10px" } }, [
            text("helpers/onboarding/req/chip", { title: ob.required.chip, tag: "span", classes: ["chip-req"], text: ob.required.chip }),
            heading("helpers/onboarding/req/h3", { title: ob.required.title, tag: "h3", classes: ["h3-22"], text: ob.required.title }),
          ]),
          flex("helpers/onboarding/req/list", { title: "Requirements", classes: ["checks", "em-navy"], css: { desktop: "color:var(--ink)" } },
            ob.required.items.map((t, i) => checkRow("helpers/onboarding/req/list", t, i, "check"))),
          // No `em-navy` here: the design's navy <strong> rule is scoped to `.checks`, and this
          // note's "Credibled" is plain bold, exactly as on Home.
          flex("helpers/onboarding/req/credibled", { title: "Credibled note", classes: ["credibled"] }, [
            block("helpers/onboarding/req/credibled/dot", { title: "Dot", classes: ["dot"] }, []),
            text("helpers/onboarding/req/credibled/t", { title: "Note", tag: "span", text: ob.required.credibled }),
          ]),
        ]),
        flex("helpers/onboarding/opt", { title: ob.optional.title, classes: ["doc-panel", "card-shadow", "stack-16"] }, [
          flex("helpers/onboarding/opt/head", { title: "Head", css: { desktop: "align-items:center;gap:10px" } }, [
            text("helpers/onboarding/opt/chip", { title: ob.optional.chip, tag: "span", classes: ["chip-info"], text: ob.optional.chip }),
            heading("helpers/onboarding/opt/h3", { title: ob.optional.title, tag: "h3", classes: ["h3-22"], text: ob.optional.title }),
          ]),
          flex("helpers/onboarding/opt/list", { title: "Credentials", classes: ["checks", "em-navy"], css: { desktop: "color:var(--ink)" } },
            ob.optional.items.map((t, i) => checkRow("helpers/onboarding/opt/list", t, i, "plus"))),
          text("helpers/onboarding/opt/note", { title: "Note", classes: ["muted-14"], css: { desktop: "margin-top:auto" }, text: ob.optional.note }),
        ]),
      ]),
    ]);

    // ------------------------------------------------------------- Earnings
    const ex = c.earnings.example;
    const earnings = flex("helpers/earnings", { title: "Earnings", tag: "section", classes: ["band"] }, [
      grid("helpers/earnings/wrap", { title: "Wrap", classes: ["sec", "wrap", "grid-2"] }, [
        flex("helpers/earnings/copy", { title: "Copy", classes: ["stack-20"] }, [
          text("helpers/earnings/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], css: { desktop: EYEBROW_LH }, text: c.earnings.eyebrow }),
          heading("helpers/earnings/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.earnings.title }),
          text("helpers/earnings/lead", { title: "Lead", classes: ["lead"], text: c.earnings.lead }),
          flex("helpers/earnings/link", { title: c.earnings.link, tag: "a", classes: ["link-arrow"], css: { desktop: PRICE_LH }, link: "#" }, [
            text("helpers/earnings/link/t", { title: c.earnings.link, tag: "span", text: c.earnings.link }),
            // 15px and navy, not the shared icon-18/icon-teal: the design's arrow is a font glyph
            // inheriting .link-arrow's own 15px size and navy colour.
            icon("helpers/earnings/link/i", "arrow-right", [], "flex:0 0 auto;width:15px;height:15px;color:var(--navy)"),
          ]),
        ]),
        flex("helpers/earnings/card", { title: "Earnings example", css: { desktop: "flex-direction:column;gap:0;padding:28px;border-radius:14px;background-color:var(--page);border-width:1.5px;border-style:solid;border-color:var(--line);max-width:460px;width:100%;margin-left:auto;margin-right:auto" } }, [
          text("helpers/earnings/card/label", { title: "Label", tag: "span", classes: ["label"], css: { desktop: `${EYEBROW_LH};margin-bottom:16px` }, text: ex.label }),
          ...ex.rows.map((row, i) => flex(`helpers/earnings/card/${i}`, { title: row.label, classes: ["price-row"], css: { desktop: PRICE_LH } }, [
            text(`helpers/earnings/card/${i}/t`, { title: row.label, tag: "span", text: row.label }),
            text(`helpers/earnings/card/${i}/a`, { title: "Amount", tag: "span", classes: ["price-amount"], text: row.amount }),
          ])),
          flex("helpers/earnings/card/total", { title: "Total", css: { desktop: "justify-content:space-between;padding-top:16px;padding-bottom:0;padding-left:0;padding-right:0;font-family:var(--font-body);font-weight:700;font-size:15px;line-height:19px;color:var(--navy)" } }, [
            text("helpers/earnings/card/total/t", { title: ex.totalLabel, tag: "span", text: ex.totalLabel }),
            // The design nests <span class="cur"> inside <span class="big">; html-v3 strips the
            // class, so the two are siblings. align-items:baseline is not convertible, flex-end is.
            flex("helpers/earnings/card/total/v", { title: "Amount", css: { desktop: "align-items:flex-end;gap:6px" } }, [
              text("helpers/earnings/card/total/big", { title: "Total", tag: "span", css: { desktop: "font-family:var(--font-display);font-weight:800;font-size:24px;line-height:31px;letter-spacing:-.02em;color:var(--navy)" }, text: ex.total }),
              text("helpers/earnings/card/total/cur", { title: ex.currency, tag: "span", css: { desktop: "font-family:var(--font-body);font-weight:500;font-size:13px;line-height:16px;color:var(--muted)" }, text: ex.currency }),
            ]),
          ]),
        ]),
      ]),
    ]);

    // ------------------------------------------------------------ Major-domo
    const md = c.major;
    const major = flex("helpers/major", { title: "Major-domo", tag: "section", classes: ["sec", "wrap"] }, [
      grid("helpers/major/panel", { title: "Panel", classes: ["grid-2", "navy", "shadow-deep"], css: { desktop: "position:relative;overflow:hidden;padding:clamp(32px,5vw,64px);border-radius:14px" } }, [
        flex("helpers/major/copy", { title: "Copy", classes: ["stack-20"], css: { desktop: "align-self:stretch" } }, [
          dashEyebrow("helpers/major/eyebrow", md.eyebrow, true),
          heading("helpers/major/h2", { title: "H2", tag: "h2", classes: ["h2-light", "em-accent"], text: `${md.title} <em>${md.titleAccent}</em>` }),
          text("helpers/major/lead", { title: "Lead", classes: ["lead-light"], css: { desktop: "max-width:560px" }, text: md.lead }),
          // The design's `.art-free`: bleeds out of the panel's own padding at the bottom, and
          // stops bleeding once the panel stacks (the design switches at 860px, the nearest V4
          // breakpoint is mobile, <=767).
          image("helpers/major/art", { title: "Illustration", css: { desktop: "display:block;align-self:flex-start;margin-top:auto;margin-bottom:calc(-1 * clamp(32px,5vw,64px));padding-top:8px;height:180px;width:auto;filter:drop-shadow(0 6px 10px rgba(0,29,90,.25))", mobile: "margin-bottom:0;height:150px;align-self:center" }, media: "ill:work-anywhere.svg", alt: "" }),
        ]),
        flex("helpers/major/rows", { title: "Criteria", css: { desktop: "flex-direction:column;gap:12px" } },
          md.rows.map((row, i) => flex(`helpers/major/rows/${i}`, { title: row.text, classes: ["row-dark"] }, [
            text(`helpers/major/rows/${i}/n`, { title: "Number", tag: "span", classes: ["num-light"], text: row.n }),
            text(`helpers/major/rows/${i}/t`, { title: row.text, tag: "span", classes: ["row-dark-t"], text: row.text }),
          ]))),
      ]),
    ]);

    // ------------------------------------------------------------------ FAQ
    const faq = flex("helpers/faq", { title: "FAQ", tag: "section", classes: ["band-top"] }, [
      grid("helpers/faq/wrap", { title: "Wrap", classes: ["sec", "wrap"], css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:clamp(32px,5vw,64px);align-items:start" } }, [
        flex("helpers/faq/head", { title: "Head", classes: ["stack-16"] }, [
          text("helpers/faq/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], css: { desktop: EYEBROW_LH }, text: c.faq.eyebrow }),
          // Deliberately NOT the `h2` class: the design opts this one heading out of balanced
          // wrapping (`text-wrap:initial`), and the theme applies text-wrap:balance to `.h2`.
          heading("helpers/faq/h2", { title: "H2", tag: "h2", css: { desktop: "font-family:var(--font-display);font-weight:800;font-size:clamp(30px,3.6vw,44px);line-height:1.1;letter-spacing:-.02em;color:var(--navy)" }, text: c.faq.title }),
          text("helpers/faq/lead", { title: "Lead", classes: ["body-16"], text: c.faq.lead }),
        ]),
        // grid-column:span 2 puts the list across the two remaining columns of the 3-column
        // auto-fit grid; on mobile the grid collapses to one column, where a span of 2 would
        // create an implicit second column and overflow the viewport.
        flex("helpers/faq/list", { title: "Questions", css: { desktop: "flex-direction:column;gap:10px;grid-column:span 2", mobile: "grid-column:span 1" } },
          c.faq.items.map((item, i) => flex(`helpers/faq/list/${i}`, { title: item.q, classes: i === 0 ? ["faq-item", "is-open"] : ["faq-item"] }, [
            flex(`helpers/faq/list/${i}/q`, { title: "Question", tag: "button", classes: ["faq-question"] }, [
              // Without flex:1 1 auto;min-width:0 the question text keeps its max-content width
              // inside the row and faq-item's overflow:hidden clips it at mobile widths.
              text(`helpers/faq/list/${i}/q/t`, { title: item.q, tag: "span", css: { desktop: "flex:1 1 auto;min-width:0" }, text: item.q }),
              // Both glyphs are rendered; anim.css swaps which one is visible off `is-open`.
              icon(`helpers/faq/list/${i}/q/plus`, "plus", ["icon-20", "icon-teal", "faq-icon-plus"]),
              icon(`helpers/faq/list/${i}/q/minus`, "minus", ["icon-20", "icon-teal", "faq-icon-minus"]),
            ]),
            text(`helpers/faq/list/${i}/a`, { title: "Answer", classes: ["faq-answer"], text: item.a }),
          ]))),
      ]),
    ]);

    // ------------------------------------------------------------ Final CTA
    const cta = flex("helpers/cta", { title: "Final CTA", tag: "section", css: { desktop: "padding:clamp(56px,8vw,96px) clamp(24px,5vw,96px);border-top-width:1.5px;border-right-width:0;border-bottom-width:0;border-left-width:0;border-style:solid;border-color:var(--line)" } }, [
      flex("helpers/cta/inner", { title: "Inner", css: { desktop: "flex-direction:column;align-items:center;gap:24px;text-align:center;width:100%;max-width:680px;margin-left:auto;margin-right:auto" } }, [
        heading("helpers/cta/h2", { title: "H2", tag: "h2", classes: ["h2-cta"], text: c.cta.title }),
        text("helpers/cta/p", { title: "Text", classes: ["body-18"], text: c.cta.text }),
        button("helpers/cta/btn", { title: c.cta.button, classes: ["btn-primary"], css: { desktop: BTN_LH }, text: c.cta.button, link: APP.signUp }),
      ]),
    ]);

    return [hero, why, rates, onboarding, earnings, major, faq, cta];
  },
};
