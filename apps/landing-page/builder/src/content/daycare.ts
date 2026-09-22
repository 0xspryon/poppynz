import type { Localized } from "./types";

export type DaycareContent = {
  hero: {
    eyebrow: string; title: string; lead: string; primary: string; secondary: string; trust: string;
    video: { src: string; credit: string };
  };
  families: { eyebrow: string; title: string; lead: string; steps: { n: string; icon: string; title: string; text: string }[] };
  notify: {
    eyebrow: string; title: string; lead: string; note: string;
    card: { chip: string; time: string; title: string; rows: { icon: string; text: string }[]; cta: string };
  };
  daycares: { eyebrow: string; title: string; lead: string; cta: string; rows: { n: string; text: string }[]; help: string; alt: string };
  cta: { title: string; text: string; primary: string; secondary: string };
};

const en: DaycareContent = {
  hero: {
    eyebrow: "Daycare matching",
    title: "Find the Perfect Daycare Spot for Your Child",
    lead: "Tell us your postal code, how many children you have and when you need a place. When a nearby daycare has an opening, we’ll let you know, it’s free to register your interest!",
    primary: "Register interest",
    secondary: "I run a daycare",
    trust: "Your details are only shared with a daycare when a spot matches · PIPEDA-compliant",
    video: { src: "https://videos.pexels.com/video-files/8612324/8612324-hd_1920_1080_25fps.mp4", credit: "Video: Yan Krukau / Pexels" },
  },
  families: {
    eyebrow: "For families",
    title: "Getting Matched Is Simple",
    lead: "Finding reliable daycare shouldn’t be stressful. We keep one list of families looking in each area, so daycares with an opening know exactly who to call.",
    steps: [
      { n: "01", icon: "map-marker", title: "Your postal code", text: "So we know which area to watch. We match by distance, not by city name." },
      { n: "02", icon: "child", title: "How many children", text: "And their ages, daycares accept specific age ranges." },
      { n: "03", icon: "calendar", title: "When you need a spot", text: "Your desired start date. Flexible is fine; say so." },
      { n: "04", icon: "bell", title: "How to reach you", text: "Name, email, phone. We only pass these to a daycare with a matching opening." },
    ],
  },
  notify: {
    eyebrow: "What you receive",
    title: "Real Openings, Real Details",
    lead: "Distance, ages accepted, start date and how to get in touch. You contact the daycare directly, we don’t sit in the middle of the conversation.",
    note: "We should be honest: registering interest doesn’t guarantee a spot, and we can’t promise there’s a daycare near you with one. What we can promise is that you’ll hear first when there is.",
    card: {
      chip: "New spot!",
      time: "Today, 9:12",
      title: "Maple Lane Home Daycare has 1 opening",
      rows: [
        { icon: "map-marker", text: "L5B · 1.8 km from you" },
        { icon: "child", text: "Ages 18 months – 4 years" },
        { icon: "calendar", text: "From 3 November" },
      ],
      cta: "Contact the daycare",
    },
  },
  daycares: {
    eyebrow: "For daycares",
    title: "Have an <em>Opening</em>? Families Nearby Are Looking.",
    lead: "List your daycare’s name and address, how many spots and which ages, plus a short description. Families already registered in your area are notified, no directory to be buried in.",
    cta: "List an opening",
    rows: [
      { n: "01", text: "Daycare name and address" },
      { n: "02", text: "Number of spots and ages accepted" },
      { n: "03", text: "A short description of your daycare and services" },
      { n: "04", text: "Contact details, families reach you directly" },
    ],
    help: "Questions about listing? A real person on our team helps daycares get set up. <a href=\"mailto:support@poppynz.com\">support@poppynz.com</a>",
    alt: "Daycare provider waving",
  },
  cta: {
    title: "Ready to Find Your Daycare Spot?",
    text: "One account covers daycare matching and everything else on Poppynz, helpers, messaging, agreements.",
    primary: "Register as a family",
    secondary: "Register a daycare",
  },
};

const fr: DaycareContent = {
  hero: {
    eyebrow: "Jumelage garderie",
    title: "Trouvez la place en garderie idéale pour votre enfant",
    lead: "Dites-nous votre code postal, combien vous avez d’enfants et quand vous avez besoin d’une place. Dès qu’une garderie près de chez vous a une ouverture, nous vous prévenons. Inscrire votre intérêt est gratuit!",
    primary: "Inscrire mon intérêt",
    secondary: "Je gère une garderie",
    trust: "Vos coordonnées ne sont transmises à une garderie que lorsqu’une place correspond · Conforme à la LPRPDE",
    video: { src: "https://videos.pexels.com/video-files/8612324/8612324-hd_1920_1080_25fps.mp4", credit: "Video: Yan Krukau / Pexels" },
  },
  families: {
    eyebrow: "Pour les familles",
    title: "Se faire jumeler, c’est simple",
    lead: "Trouver une garderie fiable ne devrait pas être stressant. Nous tenons une seule liste des familles qui cherchent dans chaque secteur, pour que les garderies ayant une ouverture sachent exactement qui appeler.",
    steps: [
      { n: "01", icon: "map-marker", title: "Votre code postal", text: "Pour savoir quel secteur surveiller. Nous jumelons selon la distance, pas selon le nom de la ville." },
      { n: "02", icon: "child", title: "Combien d’enfants", text: "Et leur âge : les garderies acceptent des tranches d’âge précises." },
      { n: "03", icon: "calendar", title: "Quand vous voulez la place", text: "Votre date de début souhaitée. Une date flexible, c’est très bien; dites-le-nous." },
      { n: "04", icon: "bell", title: "Comment vous joindre", text: "Nom, courriel, téléphone. Nous ne les transmettons qu’à une garderie dont l’ouverture correspond." },
    ],
  },
  notify: {
    eyebrow: "Ce que vous recevez",
    title: "De vraies places, de vrais détails",
    lead: "Distance, âges acceptés, date de début et façon de joindre la garderie. Vous contactez la garderie directement : nous ne nous plaçons pas au milieu de la conversation.",
    note: "Soyons honnêtes : inscrire votre intérêt ne garantit pas une place, et nous ne pouvons pas promettre qu’une garderie près de chez vous en aura une. Ce que nous pouvons promettre, c’est que vous serez les premiers avertis quand ce sera le cas.",
    card: {
      chip: "Nouvelle place!",
      time: "Aujourd’hui, 9 h 12",
      title: "La garderie en milieu familial Maple Lane a 1 place",
      rows: [
        { icon: "map-marker", text: "L5B · à 1,8 km de chez vous" },
        { icon: "child", text: "Âges : 18 mois à 4 ans" },
        { icon: "calendar", text: "À partir du 3 novembre" },
      ],
      cta: "Contacter la garderie",
    },
  },
  daycares: {
    eyebrow: "Pour les garderies",
    title: "Une <em>place</em> à combler? Des familles tout près cherchent.",
    lead: "Inscrivez le nom et l’adresse de votre garderie, le nombre de places et les âges acceptés, ainsi qu’une courte description. Les familles déjà inscrites dans votre secteur sont averties, sans répertoire où se faire oublier.",
    cta: "Inscrire une place",
    rows: [
      { n: "01", text: "Nom et adresse de la garderie" },
      { n: "02", text: "Nombre de places et âges acceptés" },
      { n: "03", text: "Une courte description de votre garderie et de vos services" },
      { n: "04", text: "Coordonnées, les familles vous joignent directement" },
    ],
    help: "Des questions sur l’inscription? Une vraie personne de notre équipe aide les garderies à démarrer. <a href=\"mailto:support@poppynz.com\">support@poppynz.com</a>",
    alt: "Responsable de garderie qui salue de la main",
  },
  cta: {
    title: "Prêt à trouver votre place en garderie?",
    text: "Un seul compte couvre le jumelage garderie et tout le reste sur Poppynz : aides familiales, messagerie, ententes.",
    primary: "S’inscrire comme famille",
    secondary: "Inscrire une garderie",
  },
};

export const DAYCARE: Localized<DaycareContent> = { en, fr };
