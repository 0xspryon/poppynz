import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Lang, Localized } from "./types";

/**
 * The blog: eight native WordPress posts, a blog index and the chrome both layouts share.
 *
 * Unlike every other key in `pages.ts`, the blog is NOT an Elementor document (spec § 8): the
 * index and the article layout are child-theme templates (`theme/poppynz/home.php` and
 * `single.php`) and the articles are ordinary posts. So this file carries plain content — text,
 * dates, image URLs — and no element tree. `emit/artefact.ts` writes it to `blog/` in the
 * artefact and `server/import.php` turns it into posts.
 *
 * English is transcribed verbatim from apps/landing-page/design/blog.html and
 * design/blog/<slug>.html. French is written here with the terminology already established in
 * content/home.ts, content/helpers.ts and content/legal.ts ("aide familiale", "garderie",
 * "séance", "courriel", "LPRPDE", "ÉPE"/"PSSP", "Major-domo" untranslated), and uses literal
 * U+00A0 no-break spaces before ":", "?", "%", "$" and inside guillemets, exactly as the other
 * French content files do. The article bodies live beside this file as HTML (`content/blog/
 * <slug>.<lang>.html`) because they are long-form markup, not strings; those files use the
 * `&nbsp;` entity for the same no-break spaces, since a literal one is invisible in HTML.
 */

export const BLOG_POSTS = [
  "vulnerable-sector-check",
  "hourly-rate",
  "tuesday-check-in",
  "put-it-in-writing",
  "reading-a-helper-profile",
  "why-families-get-verified",
  "daycare-matching",
  "born-from-a-need",
] as const;
export type BlogPostKey = (typeof BLOG_POSTS)[number];

/** Which of the two side cards the design puts beside an article. */
export type SideCardKey = "families" | "helpers";

export type BlogPost = {
  /** Per-language post slug. The permalink is /blog/<slug>/ (see server/bootstrap.php). */
  slug: string;
  title: string;
  /** The dek under the h1, and the post excerpt used by the index cards. */
  lead: string;
  /** The design's chip, its breadcrumb tail and the index filter row's label. */
  category: string;
  readTime: string;
  author: { name: string; role?: string };
  /** ISO dates. `updated` is stored as meta, never read from post_modified, which every import
   *  would otherwise bump (see server/import.php). */
  published: string;
  updated?: string;
  hero: { src: string; thumb: string; alt: string; credit: string; creditText: string; caption: string };
  /** The pills at the foot of the article. */
  tags: string[];
  side: SideCardKey;
  /** The "Keep reading" heading: the design writes "More on Safety" for the two Safety articles
   *  and "More from the blog" everywhere else, so it is copy, not a rule. */
  keepReading: string;
  related: BlogPostKey[];
  /** Filled from content/blog/<key>.<lang>.html by `blogPost()`. */
  body: string;
};

export type BlogStrings = {
  index: {
    eyebrow: string;
    h1: string;
    lead: string;
    search: string;
    /** The filter row. The first entry is the design's "All"; the rest are the categories. */
    filters: string[];
    loadMore: string;
  };
  article: {
    breadcrumb: string;
    toc: string;
    share: string;
    published: string;
    updated: string;
    keepReadingEyebrow: string;
    allArticles: string;
    /** Screen-reader labels for the three share buttons, in design order. */
    shareOn: [string, string, string];
  };
  newsletter: {
    eyebrow: string;
    /** The h2, split at the design's `<span class="accent">`. */
    h2: string;
    h2Accent: string;
    lead: string;
    email: string;
    button: string;
  };
  sideCards: Record<SideCardKey, { icon: string; title: string; text: string; cta: string }>;
  /** Month abbreviations for the design's "12 Sept 2026" date format, January first. */
  months: string[];
};

const U = "https://images.unsplash.com/";
const unsplash = (id: string, w: number) => `${U}${id}?auto=format&fit=crop&w=${w}&q=80`;
const ref = (path: string) => `https://unsplash.com/${path}?utm_source=poppynz&utm_medium=referral`;
/** The article hero's credit, with the two attribution links Unsplash asks for. */
const credit = (handle: string, name: string, lang: Lang) =>
  `${lang === "en" ? "Photo by" : "Photo de"} <a href="${ref("@" + handle)}" target="_blank" rel="noopener noreferrer">${name}</a> ${lang === "en" ? "on" : "sur"} <a href="${ref("")}" target="_blank" rel="noopener noreferrer">Unsplash</a>`;
/** The same credit as plain text. Index and "Keep reading" cards are themselves one big <a>, and
 *  an <a> inside an <a> is not parseable HTML: the browser closes the card link early and lifts
 *  the card's own contents out of it, which silently destroys the card layout. The design writes
 *  these credits without links for exactly that reason. */
const creditText = (name: string, lang: Lang) =>
  `${lang === "en" ? "Photo by" : "Photo de"} ${name} ${lang === "en" ? "on" : "sur"} Unsplash`;

const PHOTOS: Record<BlogPostKey, { id: string; handle: string; name: string }> = {
  "vulnerable-sector-check": { id: "photo-1714646793075-6dbfc604e664", handle: "silverkblack", name: "Vitaly Gariev" },
  "hourly-rate": { id: "photo-1583468991267-3f068b607ae1", handle: "awcreativeut", name: "Adam Winger" },
  "tuesday-check-in": { id: "photo-1702648156180-25d8be9c9527", handle: "ageing_better", name: "Centre for Ageing Better" },
  "put-it-in-writing": { id: "photo-1583468982228-19f19164aee2", handle: "awcreativeut", name: "Adam Winger" },
  "reading-a-helper-profile": { id: "photo-1713942590283-59867d5e3f8d", handle: "silverkblack", name: "Vitaly Gariev" },
  "why-families-get-verified": { id: "photo-1504151932400-72d4384f04b3", handle: "picsea", name: "Picsea" },
  "daycare-matching": { id: "photo-1532789339108-2ebc484efbf1", handle: "benmullins", name: "Ben Mullins" },
  "born-from-a-need": { id: "photo-1561525140-c2a4cc68e4bd", handle: "jessicarockowitz", name: "Jessica Rockowitz" },
};

function hero(key: BlogPostKey, lang: Lang, alt: string, caption: string): BlogPost["hero"] {
  const p = PHOTOS[key];
  return { src: unsplash(p.id, 1800), thumb: unsplash(p.id, 900), alt, credit: credit(p.handle, p.name, lang), creditText: creditText(p.name, lang), caption };
}

/** The article body, read from the HTML file that sits beside this module. */
export function blogBody(key: BlogPostKey, lang: Lang): string {
  return readFileSync(resolve(import.meta.dir, `blog/${key}.${lang}.html`), "utf8").trim();
}

const TEAM_EN = { name: "Poppynz team" };
const TEAM_FR = { name: "Équipe Poppynz" };

const en: Record<BlogPostKey, Omit<BlogPost, "body">> = {
  "vulnerable-sector-check": {
    slug: "vulnerable-sector-check",
    title: "What a Vulnerable Sector Check actually checks, and what it doesn’t",
    lead: "Every Poppynz helper has one. Here’s how it differs from a standard police check, why it takes longer, and how to read one if a helper shares it with you.",
    category: "Safety",
    readTime: "8 min read",
    author: TEAM_EN,
    published: "2026-09-12",
    updated: "2026-09-18",
    hero: hero("vulnerable-sector-check", "en", "Helper and child on the living-room floor", "A Vulnerable Sector Check is required for anyone working with children or vulnerable adults in a position of trust."),
    tags: ["Safety", "For families", "Verification", "PIPEDA"],
    side: "families",
    keepReading: "More on Safety",
    related: ["why-families-get-verified", "reading-a-helper-profile", "put-it-in-writing"],
  },
  "hourly-rate": {
    slug: "hourly-rate",
    title: "How to set an hourly rate you can stand behind",
    lead: "What helpers in Mississauga and Ottawa charge for childcare, tutoring and meal prep, and how the 15% service fee works.",
    category: "For helpers",
    readTime: "5 min read",
    author: TEAM_EN,
    published: "2026-09-04",
    hero: hero("hourly-rate", "en", "Helper at a kitchen table", "Your rate is the first thing a family sees after your photo. It should say something true about you."),
    tags: ["For helpers", "Rates & fees", "Getting started"],
    side: "helpers",
    keepReading: "More from the blog",
    related: ["put-it-in-writing", "reading-a-helper-profile", "tuesday-check-in"],
  },
  "tuesday-check-in": {
    slug: "tuesday-check-in",
    title: "The Tuesday check-in: what a good elderly visit looks like",
    lead: "Twenty minutes, a cup of tea and a short note home. A helper and a daughter describe the routine that works.",
    category: "Elder care",
    readTime: "6 min read",
    author: TEAM_EN,
    published: "2026-08-28",
    hero: hero("tuesday-check-in", "en", "Older man and helper on a sofa", "Most check-ins are unremarkable. That is the point of them."),
    tags: ["Elder care", "For families", "For helpers"],
    side: "families",
    keepReading: "More from the blog",
    related: ["why-families-get-verified", "put-it-in-writing", "hourly-rate"],
  },
  "put-it-in-writing": {
    slug: "put-it-in-writing",
    title: "Why we ask you to put it in writing",
    lead: "The written agreement isn’t legalese. It’s hours, rate, and what happens when a session runs long.",
    category: "Agreements",
    readTime: "4 min read",
    author: TEAM_EN,
    published: "2026-08-21",
    hero: hero("put-it-in-writing", "en", "Parent and child at a library table", "An agreement takes about five minutes to fill in. Most arguments it prevents take longer."),
    tags: ["Agreements", "For families", "For helpers"],
    side: "families",
    keepReading: "More from the blog",
    related: ["hourly-rate", "reading-a-helper-profile", "vulnerable-sector-check"],
  },
  "reading-a-helper-profile": {
    slug: "reading-a-helper-profile",
    title: "Reading a helper profile: photo, bio, rates, distance, Vetted",
    lead: "Every field on a profile is there for a reason. Here is what to look for and what to ask about in your first message.",
    category: "For families",
    readTime: "7 min read",
    author: TEAM_EN,
    published: "2026-08-14",
    hero: hero("reading-a-helper-profile", "en", "Helper reading to a child", "A profile tells you what a helper does and what we have checked. The first message tells you the rest."),
    tags: ["For families", "Verification", "Getting started"],
    side: "families",
    keepReading: "More from the blog",
    related: ["vulnerable-sector-check", "why-families-get-verified", "put-it-in-writing"],
  },
  "why-families-get-verified": {
    slug: "why-families-get-verified",
    title: "Why families get verified too",
    lead: "Helpers walk into strangers’ homes. The family safety check is how we make that a fair exchange.",
    category: "Safety",
    readTime: "5 min read",
    author: TEAM_EN,
    published: "2026-08-07",
    hero: hero("why-families-get-verified", "en", "Parent holding a baby, reading", "Trust runs both ways. A helper needs to know who is on the other side of the door as much as you do."),
    tags: ["Safety", "For families", "For helpers", "PIPEDA"],
    side: "families",
    keepReading: "More on Safety",
    related: ["vulnerable-sector-check", "reading-a-helper-profile", "born-from-a-need"],
  },
  "daycare-matching": {
    slug: "daycare-matching",
    title: "Daycare matching, without the waitlist fee",
    lead: "How registering interest works, what a daycare sees, and what we can and can’t promise.",
    category: "Daycare",
    readTime: "3 min read",
    author: TEAM_EN,
    published: "2026-07-31",
    hero: hero("daycare-matching", "en", "Two children reading on a sofa", "You tell us where and when. We tell daycares nearby. Nobody pays to be on a list."),
    tags: ["Daycare", "For families"],
    side: "families",
    keepReading: "More from the blog",
    related: ["born-from-a-need", "why-families-get-verified", "reading-a-helper-profile"],
  },
  "born-from-a-need": {
    slug: "born-from-a-need",
    title: "Poppynz: Born From a Need, Fueled by Heart",
    lead: "There was no one to call and no magic button to press. So we built one. The founder on why Poppynz exists.",
    category: "Our story",
    readTime: "4 min read",
    author: { name: "Mombie", role: "Founder, Poppynz" },
    published: "2025-01-01",
    hero: hero("born-from-a-need", "en", "Family together outdoors at golden hour", "The village we needed didn’t exist. Poppynz is our way of building it."),
    tags: ["Our story", "For families"],
    side: "families",
    keepReading: "More from the blog",
    related: ["why-families-get-verified", "daycare-matching", "vulnerable-sector-check"],
  },
};

const fr: Record<BlogPostKey, Omit<BlogPost, "body">> = {
  "vulnerable-sector-check": {
    slug: "verification-du-secteur-vulnerable",
    title: "Ce que vérifie vraiment une vérification du secteur vulnérable, et ce qu’elle ne vérifie pas",
    lead: "Chaque aide familiale Poppynz en détient une. Voici en quoi elle diffère d’une vérification policière ordinaire, pourquoi elle prend plus de temps, et comment la lire si une aide vous la montre.",
    category: "Sécurité",
    readTime: "8 min de lecture",
    author: TEAM_FR,
    published: "2026-09-12",
    updated: "2026-09-18",
    hero: hero("vulnerable-sector-check", "fr", "Une aide familiale et un enfant sur le plancher du salon", "Une vérification du secteur vulnérable est exigée de toute personne qui travaille auprès d’enfants ou d’adultes vulnérables dans un poste de confiance."),
    tags: ["Sécurité", "Pour les familles", "Vérification", "LPRPDE"],
    side: "families",
    keepReading: "Plus sur la sécurité",
    related: ["why-families-get-verified", "reading-a-helper-profile", "put-it-in-writing"],
  },
  "hourly-rate": {
    slug: "fixer-son-tarif-horaire",
    title: "Comment fixer un tarif horaire que vous pouvez assumer",
    lead: "Ce que demandent les aides familiales de Mississauga et d’Ottawa pour la garde d’enfants, le tutorat et la préparation des repas, et comment fonctionnent les frais de service de 15 %.",
    category: "Pour les aides",
    readTime: "5 min de lecture",
    author: TEAM_FR,
    published: "2026-09-04",
    hero: hero("hourly-rate", "fr", "Une aide familiale à la table de la cuisine", "Votre tarif est la première chose qu’une famille voit après votre photo. Il devrait dire quelque chose de vrai sur vous."),
    tags: ["Pour les aides", "Tarifs et frais", "Pour commencer"],
    side: "helpers",
    keepReading: "Plus d’articles du blogue",
    related: ["put-it-in-writing", "reading-a-helper-profile", "tuesday-check-in"],
  },
  "tuesday-check-in": {
    slug: "la-visite-du-mardi",
    title: "La visite du mardi : à quoi ressemble une bonne visite auprès d’un aîné",
    lead: "Vingt minutes, une tasse de thé et une courte note à la famille. Une aide familiale et une fille décrivent la routine qui fonctionne.",
    category: "Soins aux aînés",
    readTime: "6 min de lecture",
    author: TEAM_FR,
    published: "2026-08-28",
    hero: hero("tuesday-check-in", "fr", "Un homme âgé et une aide familiale sur un canapé", "La plupart des visites n’ont rien de remarquable. C’est précisément le but."),
    tags: ["Soins aux aînés", "Pour les familles", "Pour les aides"],
    side: "families",
    keepReading: "Plus d’articles du blogue",
    related: ["why-families-get-verified", "put-it-in-writing", "hourly-rate"],
  },
  "put-it-in-writing": {
    slug: "le-mettre-par-ecrit",
    title: "Pourquoi nous vous demandons de le mettre par écrit",
    lead: "L’entente écrite n’a rien de juridique. Ce sont les heures, le tarif, et ce qui arrive quand une séance se prolonge.",
    category: "Ententes",
    readTime: "4 min de lecture",
    author: TEAM_FR,
    published: "2026-08-21",
    hero: hero("put-it-in-writing", "fr", "Un parent et un enfant à une table de bibliothèque", "Remplir une entente prend environ cinq minutes. La plupart des disputes qu’elle évite prennent plus de temps."),
    tags: ["Ententes", "Pour les familles", "Pour les aides"],
    side: "families",
    keepReading: "Plus d’articles du blogue",
    related: ["hourly-rate", "reading-a-helper-profile", "vulnerable-sector-check"],
  },
  "reading-a-helper-profile": {
    slug: "lire-un-profil-d-aide-familiale",
    title: "Lire un profil d’aide familiale : photo, biographie, tarifs, distance, Vérifiée",
    lead: "Chaque champ d’un profil est là pour une raison. Voici ce qu’il faut y chercher et ce qu’il faut demander dans votre premier message.",
    category: "Pour les familles",
    readTime: "7 min de lecture",
    author: TEAM_FR,
    published: "2026-08-14",
    hero: hero("reading-a-helper-profile", "fr", "Une aide familiale fait la lecture à un enfant", "Un profil vous dit ce qu’une aide familiale fait et ce que nous avons vérifié. Le premier message vous dit le reste."),
    tags: ["Pour les familles", "Vérification", "Pour commencer"],
    side: "families",
    keepReading: "Plus d’articles du blogue",
    related: ["vulnerable-sector-check", "why-families-get-verified", "put-it-in-writing"],
  },
  "why-families-get-verified": {
    slug: "pourquoi-les-familles-sont-verifiees",
    title: "Pourquoi les familles sont vérifiées elles aussi",
    lead: "Les aides familiales entrent chez des inconnus. La vérification des familles est ce qui rend l’échange équitable.",
    category: "Sécurité",
    readTime: "5 min de lecture",
    author: TEAM_FR,
    published: "2026-08-07",
    hero: hero("why-families-get-verified", "fr", "Un parent tenant un bébé et lisant", "La confiance va dans les deux sens. Une aide familiale a autant besoin que vous de savoir qui se trouve de l’autre côté de la porte."),
    tags: ["Sécurité", "Pour les familles", "Pour les aides", "LPRPDE"],
    side: "families",
    keepReading: "Plus sur la sécurité",
    related: ["vulnerable-sector-check", "reading-a-helper-profile", "born-from-a-need"],
  },
  "daycare-matching": {
    slug: "jumelage-garderie-sans-frais",
    title: "Le jumelage garderie, sans frais de liste d’attente",
    lead: "Comment fonctionne l’inscription, ce que voit une garderie, et ce que nous pouvons ou non promettre.",
    category: "Garderie",
    readTime: "3 min de lecture",
    author: TEAM_FR,
    published: "2026-07-31",
    hero: hero("daycare-matching", "fr", "Deux enfants qui lisent sur un canapé", "Vous nous dites où et quand. Nous prévenons les garderies des environs. Personne ne paie pour figurer sur une liste."),
    tags: ["Garderie", "Pour les familles"],
    side: "families",
    keepReading: "Plus d’articles du blogue",
    related: ["born-from-a-need", "why-families-get-verified", "reading-a-helper-profile"],
  },
  "born-from-a-need": {
    slug: "nee-d-un-besoin",
    title: "Poppynz : née d’un besoin, portée par le cœur",
    lead: "Il n’y avait personne à appeler et aucun bouton magique à presser. Alors nous en avons créé un. La fondatrice explique pourquoi Poppynz existe.",
    category: "Notre histoire",
    readTime: "4 min de lecture",
    author: { name: "Mombie", role: "Fondatrice, Poppynz" },
    published: "2025-01-01",
    hero: hero("born-from-a-need", "fr", "Une famille réunie dehors à l’heure dorée", "Le village dont nous avions besoin n’existait pas. Poppynz est notre façon de le bâtir."),
    tags: ["Notre histoire", "Pour les familles"],
    side: "families",
    keepReading: "Plus d’articles du blogue",
    related: ["why-families-get-verified", "daycare-matching", "vulnerable-sector-check"],
  },
};

export const BLOG: Localized<Record<BlogPostKey, Omit<BlogPost, "body">>> = { en, fr };

export const BLOG_STRINGS: Localized<BlogStrings> = {
  en: {
    index: {
      eyebrow: "The Poppynz blog",
      h1: "Tips & Stories for Busy Families",
      lead: "Helpful guides on safety, rates, agreements and everyday care, for families and the Mom Helpers who support them.",
      search: "Search articles",
      filters: ["All", "Safety", "For families", "For helpers", "Rates & fees", "Agreements", "Elder care", "Daycare", "Our story"],
      loadMore: "Load more articles",
    },
    article: {
      breadcrumb: "Blog",
      toc: "In this article",
      share: "Share",
      published: "Published",
      updated: "Updated",
      keepReadingEyebrow: "Keep Reading",
      allArticles: "All articles",
      shareOn: ["Share on Facebook", "Share on LinkedIn", "Share on WhatsApp"],
    },
    newsletter: {
      eyebrow: "Once a month",
      h2: "Stay in the Loop With ",
      h2Accent: "Poppynz",
      lead: "One email a month with new guides and neighbourhoods. Unsubscribe any time, we never share your address.",
      email: "you@example.ca",
      button: "Subscribe",
    },
    sideCards: {
      families: {
        icon: "shield-alt",
        title: "Every helper is Vetted before you can find them",
        text: "ID, enhanced record check and VSC, reviewed by a real person.",
        cta: "Find a helper",
      },
      helpers: {
        icon: "hand-holding-heart",
        title: "Set your services, your rate and your hours",
        text: "Keep 85% of what you earn. No sign-up fee, no monthly fee.",
        cta: "Become a helper",
      },
    },
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"],
  },
  fr: {
    index: {
      eyebrow: "Le blogue Poppynz",
      h1: "Conseils et récits pour les familles occupées",
      lead: "Des guides pratiques sur la sécurité, les tarifs, les ententes et le quotidien des soins, pour les familles et les aides familiales qui les épaulent.",
      search: "Rechercher des articles",
      filters: ["Tous", "Sécurité", "Pour les familles", "Pour les aides", "Tarifs et frais", "Ententes", "Soins aux aînés", "Garderie", "Notre histoire"],
      loadMore: "Charger plus d’articles",
    },
    article: {
      breadcrumb: "Blogue",
      toc: "Dans cet article",
      share: "Partager",
      published: "Publié le",
      updated: "Mis à jour le",
      keepReadingEyebrow: "À lire ensuite",
      allArticles: "Tous les articles",
      shareOn: ["Partager sur Facebook", "Partager sur LinkedIn", "Partager sur WhatsApp"],
    },
    newsletter: {
      eyebrow: "Une fois par mois",
      h2: "Restez dans la boucle avec ",
      h2Accent: "Poppynz",
      lead: "Un courriel par mois avec les nouveaux guides et quartiers. Désabonnement en tout temps, nous ne partageons jamais votre adresse.",
      email: "vous@exemple.ca",
      button: "S’abonner",
    },
    sideCards: {
      families: {
        icon: "shield-alt",
        title: "Chaque aide familiale est vérifiée avant que vous puissiez la trouver",
        text: "Pièce d’identité, vérification approfondie des antécédents et VSV, examinées par une vraie personne.",
        cta: "Trouver une aide",
      },
      helpers: {
        icon: "hand-holding-heart",
        title: "Choisissez vos services, votre tarif et vos heures",
        text: "Gardez 85 % de ce que vous gagnez. Aucuns frais d’inscription, aucuns frais mensuels.",
        cta: "Devenir aide familiale",
      },
    },
    months: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juill.", "août", "sept.", "oct.", "nov.", "déc."],
  },
};
