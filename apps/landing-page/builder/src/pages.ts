import type { Lang, Localized } from "./content/types";
import type { El } from "./dsl";

export type PageKey = "home" | "families" | "helpers" | "safety" | "daycare" | "blog" | "privacy" | "terms" | "agreement";

export const PAGES: Record<PageKey, { slug: Localized<string>; title: Localized<string> }> = {
  home: { slug: { en: "", fr: "" }, title: { en: "Home", fr: "Accueil" } },
  families: { slug: { en: "for-families", fr: "pour-les-familles" }, title: { en: "For families", fr: "Pour les familles" } },
  helpers: { slug: { en: "for-helpers", fr: "pour-les-aides" }, title: { en: "For helpers", fr: "Pour les aides" } },
  safety: { slug: { en: "safety-and-trust", fr: "securite-et-confiance" }, title: { en: "Safety & trust", fr: "Sécurité et confiance" } },
  daycare: { slug: { en: "daycare-matching", fr: "jumelage-garderie" }, title: { en: "Daycare matching", fr: "Jumelage garderie" } },
  blog: { slug: { en: "blog", fr: "blogue" }, title: { en: "Blog", fr: "Blogue" } },
  privacy: { slug: { en: "privacy-policy", fr: "politique-de-confidentialite" }, title: { en: "Privacy Policy", fr: "Politique de confidentialité" } },
  terms: { slug: { en: "terms-of-service", fr: "conditions-d-utilisation" }, title: { en: "Terms of Service", fr: "Conditions d'utilisation" } },
  agreement: { slug: { en: "service-agreement", fr: "entente-de-service" }, title: { en: "Service Agreement", fr: "Entente de service" } },
};

export const APP = { signUp: "https://app.poppynz.com/auth/sign-up", signIn: "https://app.poppynz.com/auth/sign-in" };

export function pageUrl(key: PageKey, lang: Lang): string {
  const slug = PAGES[key].slug[lang];
  const prefix = lang === "en" ? "" : "/fr";
  return slug ? `${prefix}/${slug}` : `${prefix}/`;
}

export function resolveLinks(el: El, lang: Lang): El {
  const out: El = structuredClone(el);
  const walk = (node: El) => {
    const link = node.settings.link as { value?: { destination?: { value: string } } } | undefined;
    const dest = link?.value?.destination;
    if (dest && dest.value.startsWith("page:")) {
      const key = dest.value.slice(5) as PageKey;
      if (!PAGES[key]) throw new Error(`resolveLinks(): unknown page key "${key}" on ${node.editor_settings.title}`);
      dest.value = pageUrl(key, lang);
    }
    node.elements.forEach(walk);
  };
  walk(out);
  return out;
}
