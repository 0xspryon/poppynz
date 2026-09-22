import type { Localized } from "./types";

export type HelpersContent = {
  hero: {
    eyebrow: string;
    // Split for the `em-accent` treatment: `${title} <em>${titleAccent}</em> ${titleTail}`.
    title: string; titleAccent: string; titleTail: string;
    lead: string; ctaPrimary: string; ctaSecondary: string;
    quote: { text: string; initial: string; who: string };
    video: { src: string; credit: string; creditUrl: string };
  };
  why: { eyebrow: string; title: string; cards: { file: string; title: string; text: string }[] };
  rates: {
    eyebrow: string; title: string; lead1: string; lead2: string;
    // `file` is the service thumbnail's basename under design/assets/services (all .webp).
    panel: { label: string; rows: { file: string; name: string; rate: string }[]; custom: { name: string; rate: string }; add: string };
  };
  onboarding: {
    eyebrow: string; title: string;
    // `icon` is a line-awesome name; `chip` is the pill on the card's top-right.
    steps: { icon: string; chip: string; title: string; text: string }[];
    // Each item leads with a <strong> label styled navy by the `em-navy` parent class (theme rule).
    required: { chip: string; title: string; items: string[]; credibled: string };
    optional: { chip: string; title: string; items: string[]; note: string };
  };
  earnings: {
    eyebrow: string; title: string; lead: string; link: string;
    example: { label: string; rows: { label: string; amount: string }[]; totalLabel: string; total: string; currency: string };
  };
  major: { eyebrow: string; title: string; titleAccent: string; lead: string; rows: { n: string; text: string }[] };
  faq: { eyebrow: string; title: string; lead: string; items: { q: string; a: string }[] };
  cta: { title: string; text: string; button: string };
};

const en: HelpersContent = {
  hero: {
    eyebrow: "Become a Mom Helper",
    title: "Earn Flexibly.", titleAccent: "Support", titleTail: "Your Community.",
    lead: "Become a certified Mom Helper, set your own services and rates, work when and where you choose, and support families in your community, every one of them verified before they can message you.",
    ctaPrimary: "Become a helper",
    ctaSecondary: "See what’s required",
    quote: {
      text: "“I set my rate, I pick my hours, and I know every family I talk to has been checked. That changes how the first visit feels.”",
      initial: "P",
      who: "Priya, Mom Helper · Ottawa",
    },
    video: {
      src: "https://videos.pexels.com/video-files/5302510/5302510-hd_1920_1080_25fps.mp4",
      credit: "Video: Tima Miroshnichenko / Pexels",
      creditUrl: "https://www.pexels.com/video/mom-helping-son-to-do-his-homework-5302510/",
    },
  },
  why: {
    eyebrow: "Why Become a Mom Helper?",
    title: "Flexible Work That Fits Your Life",
    cards: [
      { file: "earnings.svg", title: "Set Your Own Rates", text: "Every service has its own hourly rate in CAD, chosen by you. Change it whenever you like." },
      { file: "verified-profile.svg", title: "Verified Families Only", text: "Households complete a safety check before they can find or message you." },
      { file: "certificate.svg", title: "Clear Agreements", text: "Hours, rate and scope go into a plain-language agreement before the first session." },
      { file: "calendar.svg", title: "Work Close to Home", text: "Families find you by distance. Work in your own neighbourhood, on your own schedule." },
    ],
  },
  rates: {
    eyebrow: "Your Services, Your Way",
    title: "Offer What You’re Great At",
    lead1: "Childcare, tutoring, elderly check-ins, pet minding, meal prep, light housekeeping, yard help, small errands, each with its own hourly rate. Offer something else? Write it in your own words and price it.",
    lead2: "You can change your services and rates whenever you like. Any agreements you’ve already signed keep their original rate.",
    panel: {
      label: "Your services",
      rows: [
        { file: "childcare", name: "Childcare", rate: "$28/hr" },
        { file: "tutoring", name: "Tutoring (grades 1–6)", rate: "$32/hr" },
        { file: "meal-preparation", name: "Meal preparation", rate: "$26/hr" },
      ],
      custom: { name: "Piano practice supervision", rate: "$30/hr" },
      add: "Add a custom service",
    },
  },
  onboarding: {
    eyebrow: "Getting Started",
    title: "Becoming a Certified Mom Helper Is Simple",
    steps: [
      { icon: "user-edit", chip: "You", title: "Complete Your Profile", text: "Photo, bio, services and rates. Say what you do in your own words." },
      { icon: "file-upload", chip: "You", title: "Verify Your ID & Background", text: "Government ID, then request your Vulnerable Sector and record checks through Credibled." },
      { icon: "user-shield", chip: "Poppynz admin", title: "Poppynz Review", text: "Someone on our team reads your full file. Every approval is reviewed by a person, never automated." },
      { icon: "check-circle", chip: "Approved", title: "Get Certified & Go Live", text: "Your Vetted badge appears and verified families nearby can find you." },
    ],
    required: {
      chip: "Required",
      title: "Every helper",
      items: [
        "<strong>Government photo ID</strong>, passport, driver’s licence or provincial card. You must be 18+.",
        "<strong>Vulnerable Sector Check</strong>, the police check required for working with children and vulnerable adults.",
        "<strong>Enhanced criminal record check</strong>, requested through Credibled from inside the app; you don’t need to visit a station.",
      ],
      credibled: "Checks are fetched securely via our partner <strong>Credibled</strong>. Results go to a Poppynz admin, not to families.",
    },
    optional: {
      chip: "Optional",
      title: "Shown on your profile",
      items: [
        "<strong>First Aid / CPR</strong>, current certificate from a recognised provider.",
        "<strong>Early Childhood Educator (ECE)</strong>, diploma or registration.",
        "<strong>Personal Support Worker (PSW)</strong>, certificate, useful for elderly check-ins.",
      ],
      note: "Credentials are verified by an admin and appear as tags on your profile. They’re not required to be approved.",
    },
  },
  earnings: {
    eyebrow: "Your Earnings",
    title: "Keep 85% of Everything You Earn",
    lead: "The 15% service fee covers payments, written agreements, session tracking, messaging and support. No sign-up fee, no monthly fee, no charge for the background check request. Payouts in CAD after each tracked session.",
    link: "Full pricing for both sides",
    example: {
      label: "Example · 3 hours of childcare",
      rows: [
        { label: "Your rate · $28/hr × 3", amount: "$84.00" },
        { label: "Poppynz service fee · 15%", amount: "− $12.60" },
      ],
      totalLabel: "You receive", total: "$71.40", currency: "CAD",
    },
  },
  major: {
    eyebrow: "Grow With Poppynz",
    title: "Become a", titleAccent: "Major-domo",
    lead: "Major-domo marks helpers with a sustained record on Poppynz, completed agreements, verified credentials, and a clean review history. It shows on your profile and tells families they’re talking to someone with a track record here.",
    rows: [
      { n: "01", text: "Approved Mom Helper with a complete profile" },
      { n: "02", text: "A sustained record of completed written agreements" },
      { n: "03", text: "Verified credentials where relevant (First Aid, ECE, PSW)" },
      { n: "04", text: "Poppynz Review of your history, then the Major-domo title" },
    ],
  },
  faq: {
    eyebrow: "Frequently Asked Questions",
    title: "Got Questions? We’ve Got Answers.",
    lead: `Something missing? <a href="mailto:support@poppynz.com"><strong>Ask support</strong></a>.`,
    items: [
      { q: "Do I need to be a mother to be a Mom Helper?", a: "No. “Mom Helper” is the name for the role, not a requirement. Students, retirees, care workers and parents of any kind all help on Poppynz. You must be 18 or older." },
      { q: "Who pays for the background check?", a: "The record checks are requested through Credibled from inside the app; there is no Poppynz charge for the request. If Credibled or your province charges a processing fee, we tell you the amount before you start." },
      { q: "How long does approval take?", a: "Identity and credential review is usually quick. Vulnerable Sector Checks depend on your local police service and can take from a few days to several weeks. You can build your profile while you wait." },
      { q: "Can I decline a family?", a: "Yes, always. You choose who to reply to and which agreements to sign. Every family you hear from has completed a safety check." },
      { q: "When and how do I get paid?", a: "After each tracked session, at your agreed rate minus the 15% service fee, in CAD to your linked account." },
      { q: "Can I be referred by someone already on Poppynz?", a: "Yes. Members can vouch for you to join. A referral speeds up the introduction but the same checks and admin review still apply." },
    ],
  },
  cta: {
    title: "Ready to Become a Mom Helper?",
    text: "Join Poppynz today, build your profile, and start supporting families in your community.",
    button: "Become a helper",
  },
};

const fr: HelpersContent = {
  hero: {
    eyebrow: "Devenez aide familiale",
    title: "Gagnez avec souplesse.", titleAccent: "Soutenez", titleTail: "votre communauté.",
    lead: "Devenez aide familiale certifiée, définissez vos services et vos tarifs, travaillez quand et où vous le voulez, et soutenez les familles de votre communauté, toutes vérifiées avant de pouvoir vous écrire.",
    ctaPrimary: "Devenir aide familiale",
    ctaSecondary: "Voir les conditions",
    quote: {
      text: "« Je fixe mon tarif, je choisis mes heures, et je sais que chaque famille à qui je parle a été vérifiée. Ça change la façon dont se déroule la première visite. »",
      initial: "P",
      who: "Priya, aide familiale · Ottawa",
    },
    video: {
      src: "https://videos.pexels.com/video-files/5302510/5302510-hd_1920_1080_25fps.mp4",
      credit: "Video: Tima Miroshnichenko / Pexels",
      creditUrl: "https://www.pexels.com/video/mom-helping-son-to-do-his-homework-5302510/",
    },
  },
  why: {
    eyebrow: "Pourquoi devenir aide familiale?",
    title: "Un travail souple qui s’adapte à votre vie",
    cards: [
      { file: "earnings.svg", title: "Fixez vos propres tarifs", text: "Chaque service a son tarif horaire en CAD, choisi par vous. Modifiez-le quand vous le voulez." },
      { file: "verified-profile.svg", title: "Des familles vérifiées seulement", text: "Les foyers effectuent une vérification de sécurité avant de pouvoir vous trouver ou vous écrire." },
      { file: "certificate.svg", title: "Des ententes claires", text: "Les heures, le tarif et la portée du travail sont consignés dans une entente en langage clair avant la première séance." },
      { file: "calendar.svg", title: "Travaillez près de chez vous", text: "Les familles vous trouvent selon la distance. Travaillez dans votre quartier, selon votre horaire." },
    ],
  },
  rates: {
    eyebrow: "Vos services, à votre façon",
    title: "Offrez ce que vous faites de mieux",
    lead1: "Garde d’enfants, tutorat, visites aux aînés, garde d’animaux, préparation des repas, entretien ménager léger, aide au jardin, petites courses : chacun avec son propre tarif horaire. Vous offrez autre chose? Décrivez-le dans vos mots et fixez-en le prix.",
    lead2: "Vous pouvez modifier vos services et vos tarifs quand vous le voulez. Les ententes déjà signées conservent leur tarif d’origine.",
    panel: {
      label: "Vos services",
      rows: [
        { file: "childcare", name: "Garde d’enfants", rate: "28 $/h" },
        { file: "tutoring", name: "Tutorat (1re à 6e année)", rate: "32 $/h" },
        { file: "meal-preparation", name: "Préparation des repas", rate: "26 $/h" },
      ],
      custom: { name: "Supervision de la pratique du piano", rate: "30 $/h" },
      add: "Ajouter un service personnalisé",
    },
  },
  onboarding: {
    eyebrow: "Pour commencer",
    title: "Devenir une aide familiale certifiée, c’est simple",
    steps: [
      { icon: "user-edit", chip: "Vous", title: "Remplissez votre profil", text: "Photo, bio, services et tarifs. Décrivez ce que vous faites dans vos mots." },
      { icon: "file-upload", chip: "Vous", title: "Vérifiez votre identité et vos antécédents", text: "Pièce d’identité gouvernementale, puis demandez vos vérifications du secteur vulnérable et du casier judiciaire auprès de Credibled." },
      { icon: "user-shield", chip: "Équipe Poppynz", title: "Révision Poppynz", text: "Un membre de notre équipe lit votre dossier complet. Chaque approbation est révisée par une personne, jamais automatisée." },
      { icon: "check-circle", chip: "Approuvée", title: "Certifiez-vous et soyez visible", text: "Votre badge Vérifiée apparaît et les familles vérifiées près de chez vous peuvent vous trouver." },
    ],
    required: {
      chip: "Obligatoire",
      title: "Chaque aide familiale",
      items: [
        "<strong>Pièce d’identité gouvernementale avec photo</strong>, passeport, permis de conduire ou carte provinciale. Vous devez avoir 18 ans ou plus.",
        "<strong>Vérification du secteur vulnérable</strong>, la vérification policière exigée pour travailler auprès d’enfants et d’adultes vulnérables.",
        "<strong>Vérification approfondie du casier judiciaire</strong>, demandée auprès de Credibled depuis l’application; vous n’avez pas à vous rendre au poste de police.",
      ],
      credibled: "Les vérifications sont obtenues de façon sécurisée auprès de notre partenaire <strong>Credibled</strong>. Les résultats vont à un membre de l’équipe Poppynz, pas aux familles.",
    },
    optional: {
      chip: "Facultatif",
      title: "Affiché sur votre profil",
      items: [
        "<strong>Premiers soins / RCR</strong>, certificat valide d’un fournisseur reconnu.",
        "<strong>Éducatrice de la petite enfance (ÉPE)</strong>, diplôme ou inscription.",
        "<strong>Préposée aux services de soutien à la personne (PSSP)</strong>, certificat, utile pour les visites aux aînés.",
      ],
      note: "Les attestations sont vérifiées par un membre de l’équipe et apparaissent comme étiquettes sur votre profil. Elles ne sont pas exigées pour être approuvée.",
    },
  },
  earnings: {
    eyebrow: "Vos gains",
    title: "Conservez 85 % de tout ce que vous gagnez",
    lead: "Les frais de service de 15 % couvrent les paiements, les ententes écrites, le suivi des séances, la messagerie et le soutien. Pas de frais d’inscription, pas de frais mensuels, aucuns frais pour la demande de vérification des antécédents. Versements en CAD après chaque séance suivie.",
    link: "La tarification complète, des deux côtés",
    example: {
      label: "Exemple · 3 heures de garde d’enfants",
      rows: [
        { label: "Votre tarif · 28 $/h × 3", amount: "84,00 $" },
        { label: "Frais de service Poppynz · 15 %", amount: "− 12,60 $" },
      ],
      totalLabel: "Vous recevez", total: "71,40 $", currency: "CAD",
    },
  },
  major: {
    eyebrow: "Évoluez avec Poppynz",
    title: "Devenez", titleAccent: "Major-domo",
    lead: "Le statut de Major-domo distingue les aides familiales au parcours soutenu sur Poppynz : ententes menées à terme, attestations vérifiées et historique de révision sans tache. Il apparaît sur votre profil et indique aux familles qu’elles s’adressent à quelqu’un qui a fait ses preuves ici.",
    rows: [
      { n: "01", text: "Aide familiale approuvée avec un profil complet" },
      { n: "02", text: "Un parcours soutenu d’ententes écrites menées à terme" },
      { n: "03", text: "Attestations vérifiées lorsque pertinent (premiers soins, ÉPE, PSSP)" },
      { n: "04", text: "Révision Poppynz de votre historique, puis le titre de Major-domo" },
    ],
  },
  faq: {
    eyebrow: "Foire aux questions",
    title: "Des questions? Nous avons les réponses.",
    lead: `Il manque quelque chose? <a href="mailto:support@poppynz.com"><strong>Écrivez au soutien</strong></a>.`,
    items: [
      { q: "Faut-il être mère pour devenir aide familiale?", a: "Non. « Aide familiale » est le nom du rôle, pas une exigence. Des étudiants, des retraités, des travailleurs de la santé et des parents de toutes sortes donnent un coup de main sur Poppynz. Vous devez avoir 18 ans ou plus." },
      { q: "Qui paie la vérification des antécédents?", a: "Les vérifications sont demandées auprès de Credibled depuis l’application; Poppynz ne facture rien pour la demande. Si Credibled ou votre province exige des frais de traitement, nous vous indiquons le montant avant que vous commenciez." },
      { q: "Combien de temps prend l’approbation?", a: "La révision de l’identité et des attestations est généralement rapide. Les vérifications du secteur vulnérable dépendent de votre service de police local et peuvent prendre de quelques jours à plusieurs semaines. Vous pouvez bâtir votre profil pendant l’attente." },
      { q: "Puis-je refuser une famille?", a: "Oui, toujours. Vous choisissez à qui répondre et quelles ententes signer. Chaque famille qui vous écrit a effectué une vérification de sécurité." },
      { q: "Quand et comment suis-je payée?", a: "Après chaque séance suivie, au tarif convenu moins les frais de service de 15 %, en CAD dans votre compte lié." },
      { q: "Puis-je être recommandée par quelqu’un déjà sur Poppynz?", a: "Oui. Les membres peuvent vous recommander pour vous inviter à vous joindre. Une recommandation accélère la présentation, mais les mêmes vérifications et la même révision par l’équipe s’appliquent." },
    ],
  },
  cta: {
    title: "Prête à devenir aide familiale?",
    text: "Rejoignez Poppynz dès aujourd’hui, bâtissez votre profil et commencez à soutenir les familles de votre communauté.",
    button: "Devenir aide familiale",
  },
};

export const HELPERS: Localized<HelpersContent> = { en, fr };
