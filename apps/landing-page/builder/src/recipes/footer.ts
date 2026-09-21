import { FOOTER } from "../content/footer";
import { flex, image, svg, text, type Recipe } from "../dsl";
import { langSwitch } from "./header";
import { HEADER } from "../content/header";

export const footerRecipe: Recipe = {
  kind: "footer", key: "footer",
  build(lang, media) {
    const c = FOOTER[lang];
    media.add("logo-mark", "../../design/assets/logo-mark.svg", "Poppynz");
    media.icon("shield-alt"); media.icon("heart");
    const cols = c.columns.map((col, i) => flex(`footer/col/${i}`, { title: col.heading, classes: ["ftr-col"] }, [
      text(`footer/col/${i}/h`, { title: col.heading, tag: "span", classes: ["label"], text: col.heading }),
      ...col.links.map((l, j) => text(`footer/col/${i}/${j}`, { title: l.label, tag: "span", classes: ["ftr-link"], text: l.label, link: l.page ? `page:${l.page}` : l.url! })),
    ]));
    return [flex("footer", { title: `Footer (${lang})`, tag: "footer", classes: ["ftr"], css: { desktop: "flex-direction:column;gap:0" } }, [
      flex("footer/grid", { title: "Columns", classes: ["ftr-grid"], css: { desktop: "display:grid" } }, [
        flex("footer/brand", { title: "Brand", classes: ["stack-16"] }, [
          flex("footer/brand/link", { title: "Brand", tag: "a", classes: ["brand"], link: "page:home" }, [
            image("footer/brand/mark", { title: "Logo mark", classes: ["brand-mark"], media: "logo-mark", alt: "" }),
            text("footer/brand/name", { title: "Brand name", tag: "span", text: HEADER[lang].brand }),
          ]),
          text("footer/tagline", { title: "Tagline", classes: ["muted-14"], css: { desktop: "max-width:320px" }, text: c.tagline }),
          flex("footer/trust", { title: "Trust line", classes: ["trust"] }, [
            svg("footer/trust/icon", { title: "Shield", classes: ["icon-18", "icon-teal"], icon: "icon:shield-alt" }),
            text("footer/trust/text", { title: "Trust", tag: "span", classes: ["muted-13"], text: c.trust }),
          ]),
          text("footer/email", { title: "Email", tag: "span", classes: ["ftr-link"], text: c.email, link: `mailto:${c.email}` }),
        ]),
        ...cols,
      ]),
      flex("footer/bottom", { title: "Bottom bar", classes: ["ftr-bottom"] }, [
        flex("footer/bottom/copy", { title: "Copyright", css: { desktop: "align-items:center;gap:6px;flex-wrap:wrap" } }, [
          text("footer/bottom/copy/text", { title: "Copyright", tag: "span", classes: ["muted-13"], text: c.copyright }),
          svg("footer/bottom/heart", { title: "Heart", classes: ["icon-18", "icon-magenta", "anim-beat"], icon: "icon:heart" }),
          text("footer/bottom/prices", { title: "Prices", tag: "span", classes: ["muted-13"], text: `· ${c.prices}` }),
        ]),
        langSwitch("footer/lang", lang, HEADER[lang].langLabels),
      ]),
    ])];
  },
};
