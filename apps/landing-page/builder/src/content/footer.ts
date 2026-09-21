import type { PageKey } from "../pages";
import type { Localized } from "./types";

export type FooterLink = { label: string; page?: PageKey; url?: string };
export type FooterContent = {
  tagline: string;
  trust: string;
  email: string;
  columns: { heading: string; links: FooterLink[] }[];
  copyright: string;
  prices: string;
};

export const FOOTER: Localized<FooterContent> = {
  en: {
    tagline: "Vetted Mom Helpers for Canadian families. Trust runs both ways.",
    trust: "Background-checked · PIPEDA-compliant · End-to-end encrypted",
    email: "support@poppynz.com",
    columns: [
      { heading: "Poppynz", links: [
        { label: "For families", page: "families" }, { label: "For helpers", page: "helpers" },
        { label: "Safety & trust", page: "safety" }, { label: "Daycare matching", page: "daycare" },
        { label: "Pricing & fees", url: "#" }, { label: "About", url: "#" }, { label: "Blog", page: "blog" } ] },
      { heading: "Support", links: [
        { label: "Help & FAQ", url: "#" }, { label: "Contact", url: "mailto:support@poppynz.com" },
        { label: "Sign in", url: "https://app.poppynz.com/auth/sign-in" }, { label: "Refer someone", url: "#" } ] },
      { heading: "Legal", links: [
        { label: "Privacy Policy", page: "privacy" }, { label: "Terms of Service", page: "terms" }, { label: "Service Agreement", page: "agreement" } ] },
    ],
    copyright: "© 2026 Poppynz Inc. · Made with care in Toronto, ON",
    prices: "Prices in CAD",
  },
  fr: {
    tagline: "Des aides familiales vérifiées pour les familles canadiennes. La confiance va dans les deux sens.",
    trust: "Vérification des antécédents · Conforme à la LPRPDE · Chiffrement de bout en bout",
    email: "support@poppynz.com",
    columns: [
      { heading: "Poppynz", links: [
        { label: "Pour les familles", page: "families" }, { label: "Pour les aides", page: "helpers" },
        { label: "Sécurité et confiance", page: "safety" }, { label: "Jumelage garderie", page: "daycare" },
        { label: "Tarifs et frais", url: "#" }, { label: "À propos", url: "#" }, { label: "Blogue", page: "blog" } ] },
      { heading: "Soutien", links: [
        { label: "Aide et FAQ", url: "#" }, { label: "Nous joindre", url: "mailto:support@poppynz.com" },
        { label: "Connexion", url: "https://app.poppynz.com/auth/sign-in" }, { label: "Recommander quelqu’un", url: "#" } ] },
      { heading: "Mentions légales", links: [
        { label: "Politique de confidentialité", page: "privacy" }, { label: "Conditions d’utilisation", page: "terms" }, { label: "Entente de service", page: "agreement" } ] },
    ],
    copyright: "© 2026 Poppynz Inc. · Conçu avec soin à Toronto (Ontario)",
    prices: "Prix en CAD",
  },
};
