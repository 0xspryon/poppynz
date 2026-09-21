import type { PageKey } from "../pages";
import type { Localized } from "./types";

export type HeaderContent = {
  brand: string;
  nav: { page: PageKey; label: string; badge?: string }[];
  signIn: string;
  getStarted: string;
  langLabels: { en: string; fr: string };
};

export const HEADER: Localized<HeaderContent> = {
  en: {
    brand: "poppynz",
    nav: [
      { page: "families", label: "For families" },
      { page: "helpers", label: "For helpers" },
      { page: "safety", label: "Safety & trust" },
      { page: "daycare", label: "Daycare", badge: "New" },
      { page: "blog", label: "Blog" },
    ],
    signIn: "Sign in",
    getStarted: "Get started",
    langLabels: { en: "EN", fr: "FR" },
  },
  fr: {
    brand: "poppynz",
    nav: [
      { page: "families", label: "Pour les familles" },
      { page: "helpers", label: "Pour les aides" },
      { page: "safety", label: "Sécurité et confiance" },
      { page: "daycare", label: "Garderie", badge: "Nouveau" },
      { page: "blog", label: "Blogue" },
    ],
    signIn: "Connexion",
    getStarted: "Commencer",
    langLabels: { en: "EN", fr: "FR" },
  },
};
