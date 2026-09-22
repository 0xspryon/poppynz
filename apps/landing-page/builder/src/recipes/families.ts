import { FAMILIES } from "../content/families";
import { block, button, flex, grid, heading, image, svg, text, video, type Recipe } from "../dsl";
import { APP } from "../pages";

const icon = (path: string, name: string, cls: string[], desktopCss?: string) =>
  svg(path, { title: name, classes: cls, icon: `icon:${name}`, ...(desktopCss ? { css: { desktop: desktopCss } } : {}) });

// Eyebrow with the animated dash, as on Home. The design uses the plain (dashless) eyebrow in the
// Benefits, Helper profile, Fee and FAQ sections and the dashed one in the Hero and Safety bands.
const dashEyebrow = (path: string, label: string, light = false) =>
  flex(path, { title: "Eyebrow", classes: [light ? "eyebrow-light" : "eyebrow"] }, [
    block(`${path}/dash`, { title: "Dash", classes: ["dash", "anim-wiggle"] }, []),
    text(`${path}/label`, { title: label, tag: "span", text: label }),
  ]);

export const familiesRecipe: Recipe = {
  kind: "page", key: "families",
  build(lang, media) {
    const c = FAMILIES[lang];
    for (const n of ["shield-alt", "check", "check-circle", "map-marker", "hand-peace", "lock", "arrow-right", "plus", "star", "heart"]) media.icon(n);
    for (const card of c.benefits.cards) media.add(`ill:${card.file}`, `../../design/assets/illustrations/${card.file}`, card.title);

    // ---------------------------------------------------------------- Hero
    const hero = flex("families/hero", { title: "Hero", tag: "section", classes: ["hero"], css: { desktop: "display:grid" } }, [
      block("families/hero/deco", { title: "Decorations", classes: ["deco"] }, [
        block("families/hero/deco/1", { title: "Dot", classes: ["deco-d1", "anim-drift"] }, []),
        block("families/hero/deco/2", { title: "Dot", classes: ["deco-d2", "anim-drift-rev"] }, []),
        icon("families/hero/deco/3", "star", ["deco-d3", "anim-twinkle"]),
        block("families/hero/deco/4", { title: "Ring", classes: ["deco-d4", "anim-drift-slow"] }, []),
        icon("families/hero/deco/5", "heart", ["deco-d5", "anim-bob"]),
      ]),
      flex("families/hero/copy", { title: "Copy", classes: ["hero-copy"], css: { desktop: "gap:24px" }, interaction: { trigger: "load", effect: "slide", direction: "bottom", durationMs: 700 } }, [
        dashEyebrow("families/hero/eyebrow", c.hero.eyebrow),
        // The h1 class carries the theme's text-wrap:balance; only the size differs from Home's
        // hero, and a local style always wins over a global class (local-*.css is enqueued after
        // global-*.css at the same specificity).
        heading("families/hero/h1", { title: "H1", tag: "h1", classes: ["h1"], css: { desktop: "font-size:clamp(38px,4.6vw,60px)" }, text: c.hero.title }),
        text("families/hero/lead", { title: "Lead", classes: ["lead-lg"], text: c.hero.lead }),
        flex("families/hero/btns", { title: "Buttons", classes: ["btn-row"] }, [
          button("families/hero/cta1", { title: c.hero.ctaPrimary, classes: ["btn-primary-15"], text: c.hero.ctaPrimary, link: APP.signUp }),
          // The design points this at the in-page anchor #how. A V4 atomic element renders no `id`
          // attribute (only data-id and its class list), so there is nothing to anchor to; this
          // keeps the design's own placeholder convention instead. See poppynz.md.
          button("families/hero/cta2", { title: c.hero.ctaSecondary, classes: ["btn-outline"], css: { desktop: "padding:14px 24px" }, text: c.hero.ctaSecondary, link: "#" }),
        ]),
        flex("families/hero/trust", { title: "Trust line", classes: ["trust"] }, [
          icon("families/hero/trust/i", "shield-alt", ["icon-18", "icon-teal"]),
          text("families/hero/trust/t", { title: "Trust", tag: "span", text: c.hero.trust }),
        ]),
      ]),
      block("families/hero/media", { title: "Video", css: { desktop: "position:relative;height:clamp(320px,42vw,560px);border-radius:14px;overflow:hidden;box-shadow:0 28px 60px -30px rgba(0,29,90,.4);background-color:var(--tint)" } }, [
        video("families/hero/video", { title: "Hero video", css: { desktop: "width:100%;height:100%;object-fit:cover" }, url: c.hero.video.src }),
        text("families/hero/media/credit", { title: "Video credit", tag: "span", classes: ["media-credit"], text: c.hero.video.credit }),
      ]),
    ]);

    // ------------------------------------------------------------ Benefits
    const benefits = flex("families/benefits", { title: "Benefits", tag: "section", classes: ["band"] }, [
      flex("families/benefits/wrap", { title: "Wrap", classes: ["sec", "wrap"], css: { desktop: "flex-direction:column;gap:40px" } }, [
        flex("families/benefits/intro", { title: "Intro", classes: ["stack-16"], css: { desktop: "max-width:720px" } }, [
          text("families/benefits/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], text: c.benefits.eyebrow }),
          heading("families/benefits/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.benefits.title }),
        ]),
        grid("families/benefits/cards", { title: "Benefit cards", css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:20px" } },
          c.benefits.cards.map((card, i) => flex(`families/benefits/cards/${i}`, { title: card.title, classes: ["art-card", i % 2 === 0 ? "tint-blue" : "tint-pink"], interaction: { trigger: "scrollIn", effect: "fade", delayMs: i * 80 } }, [
            heading(`families/benefits/cards/${i}/h3`, { title: card.title, tag: "h3", classes: ["h3"], text: card.title }),
            text(`families/benefits/cards/${i}/p`, { title: "Text", classes: ["body-15"], text: card.text }),
            image(`families/benefits/cards/${i}/art`, { title: "Illustration", classes: ["art"], media: `ill:${card.file}`, alt: "" }),
          ]))),
      ]),
    ]);

    // ------------------------------------------------------- Helper profile
    const p = c.profile;
    const card = p.card;
    const profile = grid("families/profile", { title: "Helper profile", tag: "section", classes: ["sec", "wrap"], css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:clamp(32px,5vw,64px);align-items:center" } }, [
      flex("families/profile/copy", { title: "Copy", classes: ["stack-20"] }, [
        text("families/profile/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], text: p.eyebrow }),
        heading("families/profile/h2", { title: "H2", tag: "h2", classes: ["h2"], text: p.title }),
        text("families/profile/lead", { title: "Lead", classes: ["lead"], text: p.lead }),
        // em-navy sits on the list, not on each row: the theme rule is a descendant selector, so one
        // application colours every <strong> inside.
        flex("families/profile/checks", { title: "Checks", classes: ["checks", "em-navy"], css: { desktop: "color:var(--ink)" } },
          p.checks.map((t, i) => flex(`families/profile/checks/${i}`, { title: `Check ${i + 1}`, classes: ["check-row"] }, [
            icon(`families/profile/checks/${i}/i`, "check", ["icon-18", "icon-ok"], "margin-top:2px"),
            text(`families/profile/checks/${i}/t`, { title: "Text", tag: "span", text: t }),
          ]))),
      ]),
      flex("families/profile/col", { title: "Card column", css: { desktop: "justify-content:center" } }, [
        flex("families/profile/card", { title: "Profile card", classes: ["shadow-deep"], css: { desktop: "width:min(100%,420px);flex-direction:column;gap:18px;padding:24px;border-radius:14px;background-color:var(--white);border-width:1.5px;border-style:solid;border-color:var(--line)" } }, [
          flex("families/profile/card/head", { title: "Head", css: { desktop: "gap:16px;align-items:center" } }, [
            // The design credits this photo through a visually hidden <span class="sr-only">; sr-only
            // relies on `clip`, which the converter cannot express, so the attribution lives in the
            // element's editor title instead (see poppynz.md § Named deviations).
            block("families/profile/card/photo", { title: "Photo — Christopher Campbell / Unsplash", css: { desktop: "width:72px;height:72px;border-radius:999px;flex:0 0 auto;background-image:url(https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80);background-size:cover;background-position:center" } }, []),
            flex("families/profile/card/who", { title: "Who", css: { desktop: "flex-direction:column;gap:6px" } }, [
              flex("families/profile/card/name", { title: "Name row", css: { desktop: "align-items:center;gap:8px;flex-wrap:wrap" } }, [
                text("families/profile/card/name/t", { title: card.name, tag: "span", css: { desktop: "font-family:var(--font-display);font-weight:700;font-size:22px;line-height:29px;letter-spacing:-.01em;color:var(--ink)" }, text: card.name }),
                icon("families/profile/card/name/i", "hand-peace", ["icon-20", "icon-sky", "anim-wave"]),
                flex("families/profile/card/vetted", { title: "Vetted", classes: ["vetted"], interaction: { trigger: "load", effect: "scale", delayMs: 400 } }, [
                  icon("families/profile/card/vetted/i", "check-circle", ["icon-18", "icon-ok"]),
                  text("families/profile/card/vetted/t", { title: card.vetted, tag: "span", text: card.vetted }),
                ]),
              ]),
              flex("families/profile/card/loc", { title: "Location", css: { desktop: "align-items:center;gap:6px;font-family:var(--font-body);font-weight:400;font-size:14px;line-height:17px;color:var(--muted)" } }, [
                icon("families/profile/card/loc/i", "map-marker", ["icon-teal"], "width:16px;height:16px"),
                text("families/profile/card/loc/t", { title: "Location", tag: "span", text: card.location }),
              ]),
            ]),
          ]),
          text("families/profile/card/bio", { title: "Bio", classes: ["body-15"], css: { desktop: "line-height:1.6" }, text: card.bio }),
          flex("families/profile/card/svcs", { title: "Services", css: { desktop: "flex-direction:column;gap:8px" } }, [
            text("families/profile/card/svcs/label", { title: "Label", tag: "span", classes: ["label"], text: card.servicesLabel }),
            ...card.services.map((s, i) => flex(`families/profile/card/svcs/${i}`, { title: s.name, classes: ["svc-row"] }, [
              text(`families/profile/card/svcs/${i}/t`, { title: s.name, tag: "span", text: s.name }),
              text(`families/profile/card/svcs/${i}/r`, { title: "Rate", tag: "span", classes: ["svc-rate"], text: s.rate }),
            ])),
          ]),
          flex("families/profile/card/chips", { title: "Credentials", css: { desktop: "gap:6px;flex-wrap:wrap" } },
            card.chips.map((chip, i) => text(`families/profile/card/chips/${i}`, { title: chip, tag: "span", classes: ["chip-info"], text: chip }))),
          button("families/profile/card/cta", { title: card.cta, classes: ["btn-primary-15"], css: { desktop: "display:flex;justify-content:center;padding:12px;font-size:15px" }, text: card.cta, link: APP.signUp }),
        ]),
      ]),
    ]);

    // ----------------------------------------------------- Safety in depth
    const safety = flex("families/safety", { title: "Safety in depth", tag: "section", classes: ["navy"] }, [
      flex("families/safety/wrap", { title: "Wrap", classes: ["sec", "wrap"], css: { desktop: "flex-direction:column;gap:40px" } }, [
        flex("families/safety/intro", { title: "Intro", classes: ["stack-16"], css: { desktop: "max-width:760px" } }, [
          dashEyebrow("families/safety/eyebrow", c.safety.eyebrow, true),
          heading("families/safety/h2", { title: "H2", tag: "h2", classes: ["h2-light", "em-accent"], text: `${c.safety.title} <em>${c.safety.titleAccent}</em> ${c.safety.titleTail}` }),
        ]),
        grid("families/safety/steps", { title: "Steps", classes: ["grid-cards"] },
          c.safety.steps.map((s, i) => flex(`families/safety/steps/${i}`, { title: s.title, classes: ["card-dark"], interaction: { trigger: "scrollIn", effect: "fade", delayMs: i * 80 } }, [
            text(`families/safety/steps/${i}/n`, { title: "Number", tag: "span", classes: ["num-light"], text: s.n }),
            heading(`families/safety/steps/${i}/h3`, { title: s.title, tag: "h3", classes: ["h3-light-20"], text: s.title }),
            text(`families/safety/steps/${i}/p`, { title: "Text", classes: ["body-15-light"], css: { desktop: "line-height:1.55" }, text: s.text }),
          ]))),
        flex("families/safety/foot", { title: "Footnote row", css: { desktop: "flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between" } }, [
          flex("families/safety/note", { title: "Note", classes: ["note-light"], css: { desktop: "font-size:14px" } }, [
            icon("families/safety/note/i", "lock", ["icon-sky-light"], "width:16px;height:16px"),
            text("families/safety/note/t", { title: "Note", tag: "span", text: c.safety.note }),
          ]),
          flex("families/safety/cta", { title: c.safety.cta, tag: "a", classes: ["btn-ghost-light-15"], css: { desktop: "padding:12px 20px" }, link: "page:safety" }, [
            text("families/safety/cta/t", { title: c.safety.cta, tag: "span", text: c.safety.cta }),
            icon("families/safety/cta/i", "arrow-right", ["icon-18", "icon-white"]),
          ]),
        ]),
      ]),
    ]);

    // ------------------------------------------------------------------ Fee
    const ex = c.fee.example;
    const fee = grid("families/fee", { title: "Fee", tag: "section", classes: ["sec", "wrap", "grid-2"] }, [
      flex("families/fee/copy", { title: "Copy", classes: ["stack-20"] }, [
        text("families/fee/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], text: c.fee.eyebrow }),
        heading("families/fee/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.fee.title }),
        text("families/fee/lead", { title: "Lead", classes: ["lead"], text: c.fee.lead }),
        flex("families/fee/link", { title: c.fee.link, tag: "a", classes: ["link-arrow"], link: "#" }, [
          text("families/fee/link/t", { title: c.fee.link, tag: "span", text: c.fee.link }),
          icon("families/fee/link/i", "arrow-right", ["icon-18", "icon-teal"]),
        ]),
      ]),
      // justify-self is not convertible in 4.2.4; auto side margins centre the card in its grid cell.
      flex("families/fee/card", { title: "Pricing example", classes: ["card-shadow"], css: { desktop: "flex-direction:column;gap:0;padding:28px;border-radius:14px;background-color:var(--white);border-width:1.5px;border-style:solid;border-color:var(--line);max-width:460px;width:100%;margin-left:auto;margin-right:auto" } }, [
        text("families/fee/card/label", { title: "Label", tag: "span", classes: ["label"], css: { desktop: "margin-bottom:16px" }, text: ex.label }),
        ...ex.rows.map((row, i) => flex(`families/fee/card/${i}`, { title: row.label, classes: ["price-row"] }, [
          text(`families/fee/card/${i}/t`, { title: row.label, tag: "span", text: row.label }),
          text(`families/fee/card/${i}/a`, { title: "Amount", tag: "span", classes: ["price-amount"], text: row.amount }),
        ])),
        flex("families/fee/card/total", { title: "Total", css: { desktop: "justify-content:space-between;padding-top:16px;padding-bottom:0;padding-left:0;padding-right:0;font-family:var(--font-body);font-weight:700;font-size:15px;color:var(--navy)" } }, [
          text("families/fee/card/total/t", { title: ex.totalLabel, tag: "span", text: ex.totalLabel }),
          // The design nests <span class="cur"> inside <span class="big">; html-v3 strips the class,
          // so the two are siblings. align-items:baseline is not convertible, flex-end is.
          flex("families/fee/card/total/v", { title: "Amount", css: { desktop: "align-items:flex-end;gap:6px" } }, [
            text("families/fee/card/total/big", { title: "Total", tag: "span", css: { desktop: "font-family:var(--font-display);font-weight:800;font-size:24px;line-height:31px;letter-spacing:-.02em;color:var(--navy)" }, text: ex.total }),
            text("families/fee/card/total/cur", { title: ex.currency, tag: "span", css: { desktop: "font-family:var(--font-body);font-weight:500;font-size:13px;line-height:16px;color:var(--muted)" }, text: ex.currency }),
          ]),
        ]),
      ]),
    ]);

    // ------------------------------------------------------------------ FAQ
    const faq = flex("families/faq", { title: "FAQ", tag: "section", classes: ["band-top"] }, [
      grid("families/faq/wrap", { title: "Wrap", classes: ["sec", "wrap"], css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:clamp(32px,5vw,64px);align-items:start" } }, [
        flex("families/faq/head", { title: "Head", classes: ["stack-16"] }, [
          text("families/faq/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], text: c.faq.eyebrow }),
          // Deliberately NOT the `h2` class: the design opts this one heading out of balanced
          // wrapping (`text-wrap:initial`), and the theme applies text-wrap:balance to `.h2`.
          heading("families/faq/h2", { title: "H2", tag: "h2", css: { desktop: "font-family:var(--font-display);font-weight:800;font-size:clamp(30px,3.6vw,44px);line-height:1.1;letter-spacing:-.02em;color:var(--navy)" }, text: c.faq.title }),
          text("families/faq/lead", { title: "Lead", classes: ["body-16"], text: c.faq.lead }),
        ]),
        // grid-column:span 2 puts the list across the two remaining columns of the 3-column
        // auto-fit grid; on mobile the grid collapses to one column, where a span of 2 would create
        // an implicit second column and overflow the viewport.
        flex("families/faq/list", { title: "Questions", css: { desktop: "flex-direction:column;gap:10px;grid-column:span 2", mobile: "grid-column:span 1" } },
          c.faq.items.map((item, i) => flex(`families/faq/list/${i}`, { title: item.q, classes: i === 0 ? ["faq-item", "is-open"] : ["faq-item"] }, [
            flex(`families/faq/list/${i}/q`, { title: "Question", tag: "button", classes: ["faq-question"] }, [
              // Without flex:1 1 auto;min-width:0 the question text keeps its max-content width inside the
              // row, so at mobile widths it overflows the button and faq-item's overflow:hidden clips both
              // the tail of the question and the +/- icon (measured at 390: 408px of content in a 340px box).
              text(`families/faq/list/${i}/q/t`, { title: item.q, tag: "span", css: { desktop: "flex:1 1 auto;min-width:0" }, text: item.q }),
              // faq.js does not swap the glyph, so every item keeps the plus (see poppynz.md).
              icon(`families/faq/list/${i}/q/i`, "plus", ["icon-20", "icon-teal"], "flex:0 0 auto"),
            ]),
            text(`families/faq/list/${i}/a`, { title: "Answer", classes: ["faq-answer"], text: item.a }),
          ]))),
      ]),
    ]);

    // ------------------------------------------------------------ Final CTA
    const cta = flex("families/cta", { title: "Final CTA", tag: "section", css: { desktop: "padding:clamp(56px,8vw,96px) clamp(24px,5vw,96px);border-top-width:1.5px;border-right-width:0;border-bottom-width:0;border-left-width:0;border-style:solid;border-color:var(--line)" } }, [
      flex("families/cta/inner", { title: "Inner", css: { desktop: "flex-direction:column;align-items:center;gap:24px;text-align:center;width:100%;max-width:680px;margin-left:auto;margin-right:auto" } }, [
        heading("families/cta/h2", { title: "H2", tag: "h2", classes: ["h2-cta"], text: c.cta.title }),
        text("families/cta/p", { title: "Text", classes: ["body-18"], text: c.cta.text }),
        button("families/cta/btn", { title: c.cta.button, classes: ["btn-primary"], text: c.cta.button, link: APP.signUp }),
      ]),
    ]);

    return [hero, benefits, profile, safety, fee, faq, cta];
  },
};
