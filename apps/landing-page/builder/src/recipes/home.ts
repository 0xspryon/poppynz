import { HOME } from "../content/home";
import { block, button, flex, grid, heading, image, svg, text, video, type El, type Recipe } from "../dsl";
import { APP } from "../pages";

const eyebrow = (path: string, label: string, light = false) =>
  flex(path, { title: "Eyebrow", classes: [light ? "eyebrow-light" : "eyebrow"] }, [
    block(`${path}/dash`, { title: "Dash", classes: ["dash", "anim-wiggle"] }, []),
    text(`${path}/label`, { title: label, tag: "span", text: label }),
  ]);

const icon = (path: string, name: string, cls: string[]) => svg(path, { title: name, classes: cls, icon: `icon:${name}` });

export const homeRecipe: Recipe = {
  kind: "page", key: "home",
  build(lang, media) {
    const c = HOME[lang];
    for (const n of ["search", "hand-holding-heart", "arrow-right", "shield-alt", "check-circle", "clipboard-list", "map-marked-alt", "file-signature", "stopwatch", "id-card", "check", "plus", "user-shield", "lock", "home", "smile-wink", "map-marker", "star", "heart"]) media.icon(n);
    for (const s of c.services) media.add(`svc:${s.file}`, `../../design/assets/services/${s.file}.webp`, s.name);

    const heroCard = (path: string, side: "l" | "r", card: { title: string; text: string; cta: string }, iconName: string) =>
      flex(path, { title: card.title, tag: "a", classes: ["hero-card", side === "l" ? "hero-card-l" : "hero-card-r"], link: APP.signUp }, [
        flex(`${path}/bubble`, { title: "Icon", classes: ["bubble", "bubble-40"] }, [icon(`${path}/icon`, iconName, ["icon-20", "icon-teal", ...(side === "r" ? ["anim-wave"] : [])])]),
        text(`${path}/t`, { title: "Title", tag: "span", classes: ["hero-card-title"], text: card.title }),
        text(`${path}/d`, { title: "Text", tag: "span", classes: ["hero-card-text"], text: card.text }),
        flex(`${path}/go`, { title: "CTA", classes: [side === "l" ? "go-sky" : "go-navy"] }, [
          text(`${path}/go/t`, { title: card.cta, tag: "span", text: card.cta }),
          icon(`${path}/go/i`, "arrow-right", ["icon-18", "icon-white", "anim-bob"]),
        ]),
      ]);

    const hero = flex("home/hero", { title: "Hero", tag: "section", classes: ["hero"], css: { desktop: "display:grid" } }, [
      block("home/hero/deco", { title: "Decorations", classes: ["deco"] }, [
        block("home/hero/deco/1", { title: "Dot", classes: ["deco-d1", "anim-drift"] }, []),
        block("home/hero/deco/2", { title: "Dot", classes: ["deco-d2", "anim-drift-rev"] }, []),
        icon("home/hero/deco/3", "star", ["deco-d3", "anim-twinkle"]),
        block("home/hero/deco/4", { title: "Ring", classes: ["deco-d4", "anim-drift-slow"] }, []),
        icon("home/hero/deco/5", "heart", ["deco-d5", "anim-bob"]),
      ]),
      flex("home/hero/copy", { title: "Copy", classes: ["hero-copy"], interaction: { trigger: "load", effect: "slide", direction: "bottom", durationMs: 700 } }, [
        eyebrow("home/hero/eyebrow", c.hero.eyebrow),
        heading("home/hero/h1", { title: "H1", tag: "h1", classes: ["h1", "hl-wavy"], text: `${c.hero.title} <em>${c.hero.titleHighlight}</em>` }),
        text("home/hero/lead", { title: "Lead", classes: ["lead-lg"], text: c.hero.lead }),
        grid("home/hero/cards", { title: "Choice cards", css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px;max-width:580px" } }, [
          heroCard("home/hero/cards/l", "l", c.hero.cardLeft, "search"),
          heroCard("home/hero/cards/r", "r", c.hero.cardRight, "hand-holding-heart"),
        ]),
        flex("home/hero/trust", { title: "Trust line", classes: ["trust"] }, [icon("home/hero/trust/i", "shield-alt", ["icon-18", "icon-teal"]), text("home/hero/trust/t", { title: "Trust", tag: "span", text: c.hero.trust })]),
      ]),
      block("home/hero/media", { title: "Video", classes: ["media-box"] }, [
        video("home/hero/video", { title: "Hero video", css: { desktop: "width:100%;height:100%;object-fit:cover" }, url: c.hero.video.src }),
        flex("home/hero/float", { title: "Floating card", classes: ["float-card", "anim-float"] }, [
          text("home/hero/float/av", { title: "Avatar", tag: "span", classes: ["avatar"], text: c.hero.floatCard.initial }),
          flex("home/hero/float/lines", { title: "Lines", css: { desktop: "flex-direction:column;gap:3px" } }, [
            text("home/hero/float/name", { title: "Name", tag: "span", css: { desktop: "font-family:var(--font-display);font-weight:700;font-size:15px;color:var(--ink)" }, text: c.hero.floatCard.name }),
            text("home/hero/float/meta", { title: "Meta", tag: "span", classes: ["muted-13"], text: c.hero.floatCard.meta }),
          ]),
          flex("home/hero/float/vetted", { title: "Vetted", classes: ["vetted"], interaction: { trigger: "load", effect: "scale", delayMs: 400 } }, [icon("home/hero/float/vetted/i", "check-circle", ["icon-18", "icon-ok"]), text("home/hero/float/vetted/t", { title: "Vetted", tag: "span", text: c.hero.floatCard.vetted })]),
        ]),
      ]),
    ]);

    const steps = flex("home/how", { title: "How it works", tag: "section", classes: ["band"] }, [
      grid("home/how/wrap", { title: "Wrap", classes: ["wrap"], css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:clamp(32px,5vw,64px);padding:clamp(56px,8vw,96px) clamp(24px,5vw,96px);align-items:start" } }, [
        flex("home/how/intro", { title: "Intro", classes: ["stack-16"], css: { desktop: "max-width:420px" } }, [
          text("home/how/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], text: c.how.eyebrow }),
          heading("home/how/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.how.title }),
          text("home/how/lead", { title: "Lead", classes: ["lead"], text: c.how.lead }),
        ]),
        grid("home/how/steps", { title: "Steps", css: { desktop: "grid-column:span 2;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:20px", mobile: "grid-column:span 1" } },
          c.steps.map((s, i) => flex(`home/how/steps/${i}`, { title: s.title, classes: ["card", "card-lift"], interaction: { trigger: "scrollIn", effect: "fade", delayMs: i * 80 } }, [
            flex(`home/how/steps/${i}/top`, { title: "Top", classes: ["step-top"] }, [
              flex(`home/how/steps/${i}/bubble`, { title: "Icon", classes: ["bubble"] }, [icon(`home/how/steps/${i}/icon`, s.icon, ["icon-22", "icon-teal"])]),
              text(`home/how/steps/${i}/n`, { title: "Number", tag: "span", classes: ["step-num"], text: s.n }),
            ]),
            heading(`home/how/steps/${i}/h3`, { title: s.title, tag: "h3", classes: ["h3"], text: s.title }),
            text(`home/how/steps/${i}/p`, { title: "Text", classes: ["body-15"], text: s.text }),
          ]))),
      ]),
    ]);

    const check = (path: string, label: string, plus = false) => flex(path, { title: label, classes: ["check-row"] }, [icon(`${path}/i`, plus ? "plus" : "check", ["icon-18", plus ? "icon-teal" : "icon-ok"]), text(`${path}/t`, { title: label, tag: "span", text: label })]);
    const safety = flex("home/safety", { title: "Two-way safety", tag: "section", classes: ["sec", "wrap"], css: { desktop: "flex-direction:column;gap:48px" } }, [
      flex("home/safety/intro", { title: "Intro", classes: ["stack-16"], css: { desktop: "max-width:800px" } }, [
        text("home/safety/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], text: c.safety.eyebrow }),
        heading("home/safety/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.safety.title }),
      ]),
      grid("home/safety/cards", { title: "Panels", classes: ["grid-cards"] }, [
        flex("home/safety/helpers", { title: c.safety.helpers.title, classes: ["panel"] }, [
          flex("home/safety/helpers/bubble", { title: "Icon", classes: ["bubble", "bubble-48"] }, [icon("home/safety/helpers/icon", "id-card", ["icon-24", "icon-teal"])]),
          heading("home/safety/helpers/h3", { title: "H3", tag: "h3", classes: ["h3-lg"], text: c.safety.helpers.title }),
          flex("home/safety/helpers/checks", { title: "Checks", classes: ["checks"] }, [...c.safety.helpers.checks.map((t, i) => check(`home/safety/helpers/checks/${i}`, t)), check("home/safety/helpers/checks/opt", c.safety.helpers.optional, true)]),
          flex("home/safety/helpers/credibled", { title: "Credibled", classes: ["credibled"] }, [block("home/safety/helpers/credibled/dot", { title: "Dot", classes: ["dot"] }, []), text("home/safety/helpers/credibled/t", { title: "Text", tag: "span", text: c.safety.helpers.credibled })]),
        ]),
        flex("home/safety/reviewed", { title: c.safety.reviewed.title, classes: ["panel-navy"] }, [
          flex("home/safety/reviewed/bubble", { title: "Icon", classes: ["bubble-light"] }, [icon("home/safety/reviewed/icon", "user-shield", ["icon-24", "icon-sky-light"])]),
          heading("home/safety/reviewed/h3", { title: "H3", tag: "h3", classes: ["h3-light"], text: c.safety.reviewed.title }),
          text("home/safety/reviewed/p1", { title: "P1", classes: ["body-15-light"], text: c.safety.reviewed.p1 }),
          text("home/safety/reviewed/p2", { title: "P2", classes: ["body-15-light"], text: c.safety.reviewed.p2 }),
          flex("home/safety/reviewed/note", { title: "Note", classes: ["note-light"], css: { desktop: "margin-top:auto" } }, [icon("home/safety/reviewed/note/i", "lock", ["icon-18", "icon-sky-light"]), text("home/safety/reviewed/note/t", { title: "Note", tag: "span", text: c.safety.reviewed.note })]),
        ]),
        flex("home/safety/families", { title: c.safety.families.title, classes: ["panel"] }, [
          flex("home/safety/families/bubble", { title: "Icon", classes: ["bubble", "bubble-48"] }, [icon("home/safety/families/icon", "home", ["icon-24", "icon-teal"])]),
          heading("home/safety/families/h3", { title: "H3", tag: "h3", classes: ["h3-lg"], text: c.safety.families.title }),
          text("home/safety/families/p", { title: "Text", classes: ["body-15"], text: c.safety.families.text }),
          flex("home/safety/families/link", { title: "Link", tag: "a", classes: ["link-arrow"], css: { desktop: "margin-top:auto" }, link: "page:safety" }, [text("home/safety/families/link/t", { title: "Link", tag: "span", text: c.safety.families.link }), icon("home/safety/families/link/i", "arrow-right", ["icon-18", "icon-teal"])]),
        ]),
      ]),
    ]);

    const services = flex("home/services", { title: "Services", tag: "section", classes: ["band"] }, [
      flex("home/services/wrap", { title: "Wrap", classes: ["sec", "wrap"], css: { desktop: "flex-direction:column;gap:40px" } }, [
        flex("home/services/head", { title: "Heading row", css: { desktop: "flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:24px 40px" } }, [
          flex("home/services/intro", { title: "Intro", classes: ["stack-16"], css: { desktop: "max-width:620px" } }, [
            text("home/services/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], text: c.servicesHeader.eyebrow }),
            flex("home/services/h2row", { title: "Title row", css: { desktop: "align-items:center;gap:12px;flex-wrap:wrap" } }, [heading("home/services/h2", { title: "H2", tag: "h2", classes: ["h2"], text: c.servicesHeader.title }), icon("home/services/wink", "smile-wink", ["icon-24", "icon-sky", "anim-wiggle"])]),
          ]),
          text("home/services/lead", { title: "Lead", classes: ["body-16"], css: { desktop: "max-width:380px" }, text: c.servicesHeader.lead }),
        ]),
        grid("home/services/grid", { title: "Service cards", css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px" } },
          c.services.map((s, i) => flex(`home/services/${s.file}`, { title: s.name, tag: "a", classes: ["svc", ...((i + Math.floor(i / 4)) % 2 ? ["svc-pink"] : [])], link: APP.signUp }, [
            text(`home/services/${s.file}/t`, { title: s.name, tag: "span", classes: ["svc-title"], text: s.name }),
            text(`home/services/${s.file}/d`, { title: "Text", tag: "span", classes: ["svc-text"], text: s.text }),
            image(`home/services/${s.file}/art`, { title: "Illustration", classes: ["svc-art"], media: `svc:${s.file}`, alt: "" }),
          ]))),
      ]),
    ]);

    const quotes = grid("home/quotes", { title: "Testimonials", tag: "section", classes: ["grid-cards", "wrap"], css: { desktop: "padding:clamp(56px,8vw,96px) clamp(24px,5vw,96px) 48px" } },
      c.quotes.map((q, i) => flex(`home/quotes/${i}`, { title: q.who, classes: ["quote"], css: { desktop: `transform:rotate(${["-1.2deg", "0.8deg", "-0.6deg"][i]})` } }, [
        text(`home/quotes/${i}/q`, { title: "Quote", classes: ["quote-text"], text: q.text }),
        flex(`home/quotes/${i}/who`, { title: "Who", classes: ["quote-who"] }, [text(`home/quotes/${i}/av`, { title: "Avatar", tag: "span", classes: ["avatar"], text: q.initial }), text(`home/quotes/${i}/name`, { title: "Name", tag: "span", classes: ["muted-14"], text: q.who })]),
      ])));

    const neighbourhood = flex("home/hood", { title: "Neighbourhood", tag: "section", classes: ["wrap"], css: { desktop: "padding:0 clamp(24px,5vw,96px) clamp(56px,8vw,96px)" } }, [
      grid("home/hood/card", { title: "Card", classes: ["card-shadow"], css: { desktop: "grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));border-radius:14px;overflow:hidden;background-color:var(--white);border-width:1.5px;border-style:solid;border-color:var(--line)" } }, [
        block("home/hood/photo", { title: "Photo", css: { desktop: "min-height:320px;background-color:var(--tint);background-image:url(https://images.unsplash.com/photo-1658314755707-1fbdf7c40145?auto=format&fit=crop&w=1200&q=80);background-size:cover;background-position:center" } }, []),
        flex("home/hood/copy", { title: "Copy", classes: ["stack-24"], css: { desktop: "padding:clamp(28px,4vw,56px)" } }, [
          text("home/hood/eyebrow", { title: "Eyebrow", classes: ["eyebrow"], text: c.neighbourhood.eyebrow }),
          heading("home/hood/h2", { title: "H2", tag: "h2", classes: ["h2-sm"], text: c.neighbourhood.title }),
          text("home/hood/lead", { title: "Lead", classes: ["lead"], text: c.neighbourhood.lead }),
          flex("home/hood/cities", { title: "Cities", css: { desktop: "flex-wrap:wrap;gap:10px" } }, [
            ...c.cities.map((city, i) => flex(`home/hood/cities/${i}`, { title: city, classes: ["city"] }, [icon(`home/hood/cities/${i}/i`, "map-marker", ["icon-18", "icon-teal"]), text(`home/hood/cities/${i}/t`, { title: city, tag: "span", text: city })])),
            flex("home/hood/cities/next", { title: "Next", classes: ["city-next"] }, [icon("home/hood/cities/next/i", "star", ["icon-18", "icon-magenta"]), text("home/hood/cities/next/t", { title: "Next", tag: "span", text: c.neighbourhood.next })]),
          ]),
          text("home/hood/note", { title: "Note", classes: ["muted-14"], text: c.neighbourhood.note }),
        ]),
      ]),
    ]);

    const helpers = flex("home/helpers", { title: "Become a helper", tag: "section", classes: ["wrap"], css: { desktop: "padding:0 clamp(24px,5vw,96px) clamp(56px,8vw,96px)" } }, [
      grid("home/helpers/card", { title: "Card", classes: ["grid-2", "navy", "shadow-deep"], css: { desktop: "padding:clamp(32px,5vw,64px);border-radius:14px" } }, [
        flex("home/helpers/copy", { title: "Copy", classes: ["stack-24"] }, [
          eyebrow("home/helpers/eyebrow", c.helpers.eyebrow, true),
          heading("home/helpers/h2", { title: "H2", tag: "h2", classes: ["h2-light", "em-accent"], text: `${c.helpers.title} <em>${c.helpers.titleAccent}</em> ${c.helpers.titleTail}` }),
          text("home/helpers/lead", { title: "Lead", classes: ["lead-light"], css: { desktop: "max-width:560px" }, text: c.helpers.lead }),
          flex("home/helpers/btns", { title: "Buttons", classes: ["btn-row"] }, [
            button("home/helpers/cta1", { title: c.helpers.ctaPrimary, classes: ["btn-primary-14"], text: c.helpers.ctaPrimary, link: APP.signUp }),
            button("home/helpers/cta2", { title: c.helpers.ctaSecondary, classes: ["btn-ghost-light-15"], text: c.helpers.ctaSecondary, link: "page:helpers" }),
          ]),
        ]),
        block("home/helpers/photo", { title: "Photo", css: { desktop: "height:clamp(240px,30vw,340px);border-radius:14px;overflow:hidden;background-image:url(https://images.unsplash.com/photo-1583468991267-3f068b607ae1?auto=format&fit=crop&w=1000&q=80);background-size:cover;background-position:center" } }, []),
      ]),
    ]);

    const cta = flex("home/cta", { title: "Final CTA", tag: "section", classes: ["band-top"] }, [
      flex("home/cta/inner", { title: "Inner", classes: ["cta-inner"] }, [
        heading("home/cta/h2", { title: "H2", tag: "h2", classes: ["h2-cta"], text: c.cta.title }),
        text("home/cta/p", { title: "Text", classes: ["body-18"], text: c.cta.text }),
        flex("home/cta/btns", { title: "Buttons", classes: ["btn-row-center"] }, [
          button("home/cta/find", { title: c.cta.find, classes: ["btn-primary"], text: c.cta.find, link: APP.signUp }),
          button("home/cta/become", { title: c.cta.become, classes: ["btn-outline"], text: c.cta.become, link: APP.signUp }),
        ]),
      ]),
    ]);

    return [hero, steps, safety, services, quotes, neighbourhood, helpers, cta];
  },
};
