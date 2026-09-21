import { HEADER } from "../content/header";
import type { Lang } from "../content/types";
import { block, flex, image, text, type El, type Recipe } from "../dsl";
import type { MediaRegistry } from "../media";
import { APP } from "../pages";

export function langSwitch(path: string, lang: Lang, labels: { en: string; fr: string }): El {
  // Each item links to the same page in the other language; Polylang redirects "/" and "/fr/" to the right front page.
  const item = (l: Lang) => text(`${path}/${l}`, { title: labels[l], tag: "span", classes: ["lang-item", ...(l === lang ? ["lang-on"] : [])], text: labels[l], link: l === "en" ? "/" : "/fr/" });
  return flex(path, { title: "Language", classes: ["lang"] }, [item("en"), item("fr")]);
}

export const headerRecipe: Recipe = {
  kind: "header", key: "header",
  build(lang, media) {
    const c = HEADER[lang];
    media.add("logo-mark", "../../design/assets/logo-mark.svg", "Poppynz");
    const nav = c.nav.map((item) => flex(`header/nav/${item.page}`, { title: item.label, tag: "a", classes: ["nav-link"], link: `page:${item.page}` }, [
      text(`header/nav/${item.page}/label`, { title: item.label, tag: "span", text: item.label }),
      ...(item.badge ? [text(`header/nav/${item.page}/badge`, { title: "Badge", tag: "span", classes: ["badge-new", "anim-wiggle-badge"], text: item.badge })] : []),
    ]));
    return [flex("header", { title: `Header (${lang})`, tag: "header", classes: ["hdr"] }, [
      flex("header/brand", { title: "Brand", tag: "a", classes: ["brand"], link: "page:home" }, [
        image("header/brand/mark", { title: "Logo mark", classes: ["brand-mark"], media: "logo-mark", alt: "" }),
        text("header/brand/name", { title: "Brand name", tag: "span", text: c.brand }),
      ]),
      flex("header/nav", { title: "Nav", classes: ["hdr-nav"] }, nav),
      flex("header/actions", { title: "Actions", classes: ["hdr-actions"] }, [
        langSwitch("header/lang", lang, c.langLabels),
        text("header/signin", { title: c.signIn, tag: "span", classes: ["signin"], text: c.signIn, link: APP.signIn }),
        text("header/getstarted", { title: c.getStarted, tag: "span", classes: ["getstarted"], text: c.getStarted, link: APP.signUp }),
      ]),
    ])];
  },
};
