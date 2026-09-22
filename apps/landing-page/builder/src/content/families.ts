import type { Localized } from "./types";

export type FamiliesContent = {
  hero: {
    eyebrow: string; title: string; lead: string; ctaPrimary: string; ctaSecondary: string; trust: string;
    video: { src: string; credit: string };
  };
  // `file` is the illustration's filename under design/assets/illustrations (extensions differ:
  // two .webp photos, two .svg drawings), so it carries the extension.
  benefits: { eyebrow: string; title: string; cards: { file: string; title: string; text: string }[] };
  profile: {
    eyebrow: string; title: string; lead: string;
    // Each entry leads with a <strong> label styled navy by the `em-navy` parent class (theme rule).
    checks: string[];
    card: {
      name: string; vetted: string; location: string; bio: string; servicesLabel: string;
      services: { name: string; rate: string }[]; chips: string[]; cta: string;
    };
  };
  safety: {
    eyebrow: string; title: string; titleAccent: string; titleTail: string;
    steps: { n: string; title: string; text: string }[];
    note: string; cta: string;
  };
  fee: {
    eyebrow: string; title: string; lead: string; link: string;
    example: { label: string; rows: { label: string; amount: string }[]; totalLabel: string; total: string; currency: string };
  };
  faq: { eyebrow: string; title: string; lead: string; items: { q: string; a: string }[] };
  cta: { title: string; text: string; button: string };
};

const en: FamiliesContent = {
  hero: {
    eyebrow: "For families",
    title: "Reliable Help. When You Need It.",
    lead: "Childcare, tutoring, meal prep, elderly check-ins and more, find a certified Mom Helper in your area, agree on a rate together, and enjoy secure payment after each session.",
    ctaPrimary: "Find a helper",
    ctaSecondary: "See how it works",
    trust: "Background-checked helpers · Human-reviewed approvals · PIPEDA-compliant",
    video: { src: "https://videos.pexels.com/video-files/4499352/4499352-hd_1920_1080_25fps.mp4", credit: "Video: Julia M Cameron / Pexels" },
  },
  benefits: {
    eyebrow: "Why Families Love Poppynz",
    title: "Everything You Need for Peace of Mind",
    cards: [
      { file: "shield-family.webp", title: "Verified Before You Meet", text: "Government ID, Vulnerable Sector Check and an enhanced criminal record check, reviewed by a human admin." },
      { file: "search.webp", title: "Right in Your Neighbourhood", text: "We sort by distance, so your helper is usually a few streets away rather than across the city." },
      { file: "earnings.svg", title: "Transparent Rates", text: "Every service on a profile has its hourly rate right next to it, in CAD. No quotes to chase, no bidding." },
      { file: "certificate.svg", title: "Clear Agreements", text: "Hours, rate and expectations go into a simple written agreement before anyone comes over." },
    ],
  },
  profile: {
    eyebrow: "Meet Your Helper",
    title: "Everything You Need to Choose With Confidence",
    lead: "Every helper profile shows the same things, in the same order. You won’t see star ratings yet, we’d rather show you a real bio and real checks than a number.",
    checks: [
      "<strong>Name and photo</strong>, first name and last initial, a real photo",
      "<strong>Bio</strong>, in the helper’s own words",
      "<strong>Services with hourly rates</strong>, each one priced separately in CAD",
      "<strong>Vetted badge</strong>, only shown after admin approval",
      "<strong>Credentials</strong>, First Aid, ECE, PSW when held",
      "<strong>Distance</strong>, from your home, in kilometres",
    ],
    card: {
      name: "Maria O.",
      vetted: "Vetted",
      location: "1.2 km away · Port Credit, Mississauga",
      bio: "ECE-trained, eight years with toddlers and school-age kids. I like a calm after-school routine: snack, homework, outside if it isn’t pouring.",
      servicesLabel: "Services",
      services: [
        { name: "Childcare", rate: "$28/hr" },
        { name: "Tutoring (grades 1–6)", rate: "$32/hr" },
        { name: "Meal preparation", rate: "$26/hr" },
      ],
      chips: ["First Aid", "ECE", "Vulnerable Sector Check"],
      cta: "Message Maria",
    },
  },
  safety: {
    eyebrow: "Safety First",
    title: "Every Helper Passes", titleAccent: "Four Steps", titleTail: "Before You Meet Them",
    steps: [
      { n: "01", title: "Identity confirmed", text: "A government photo ID is matched to the person and the profile." },
      { n: "02", title: "Records checked", text: "Vulnerable Sector Check and enhanced criminal record check, fetched through Credibled." },
      { n: "03", title: "Credentials verified", text: "First Aid, ECE or PSW certificates are checked when a helper lists them." },
      { n: "04", title: "A human approves", text: "A Poppynz admin reviews the full file. Only then does the Vetted badge appear." },
    ],
    note: "Record checks via our partner Credibled · PIPEDA-compliant · End-to-end encrypted messaging",
    cta: "Read every check in plain language",
  },
  fee: {
    eyebrow: "Simple, Transparent Pricing",
    title: "The Helper’s Rate, Plus 5%. That’s It!",
    lead: "There’s no subscription, booking fee or minimum. Helpers set their own hourly rate in CAD, and we add a 5% service fee that covers payments, agreements and support. You’ll always see the total before agreeing to anything.",
    link: "Full pricing for both sides",
    example: {
      label: "Example · 3 hours of childcare",
      rows: [
        { label: "Maria’s rate · $28/hr × 3", amount: "$84.00" },
        { label: "Poppynz service fee · 5%", amount: "$4.20" },
      ],
      totalLabel: "You pay", total: "$88.20", currency: "CAD",
    },
  },
  faq: {
    eyebrow: "Frequently Asked Questions",
    title: "Got Questions? We’ve Got Answers.",
    lead: `Something missing? <a href="mailto:support@poppynz.com"><strong>Ask support</strong></a>, a person replies.`,
    items: [
      { q: "Who are Mom Helpers?", a: "Local people, often parents, students, retired educators or care workers, who offer everyday help in their own neighbourhood. Every one has passed identity and background checks and been approved by a Poppynz admin before appearing in search." },
      { q: "Why do I have to complete a safety check too?", a: "Helpers walk into your home. A short family verification means they only ever hear from real, verified households, it’s what makes trust run both ways." },
      { q: "How do I pay?", a: "Sessions are tracked in the app and billed at the helper’s hourly rate plus a 5% service fee, in CAD. There are no subscriptions or minimums." },
      { q: "What does the written agreement cover?", a: "Hours, rate, what the work includes, and what happens if a session runs long or is cancelled. It’s plain language and signed inside Poppynz before the first session." },
      { q: "Can I hire the same helper regularly?", a: "Yes. Most families do. You can set up recurring sessions with a helper you already have an agreement with." },
      { q: "What if something goes wrong?", a: "Message support from inside the app, a person replies. Every session, message and agreement is logged, so there is a clear record to work from." },
    ],
  },
  cta: {
    title: "Ready to Find Your Perfect Helper?",
    text: "Join Poppynz today and discover certified Mom Helpers in your area.",
    button: "Find a helper",
  },
};

const fr: FamiliesContent = {
  hero: {
    eyebrow: "Pour les familles",
    title: "Une aide fiable. Quand vous en avez besoin.",
    lead: "Garde d’enfants, tutorat, préparation des repas, visites aux aînés et plus encore : trouvez une aide familiale certifiée près de chez vous, convenez ensemble d’un tarif, et profitez d’un paiement sécurisé après chaque séance.",
    ctaPrimary: "Trouver une aide",
    ctaSecondary: "Voir comment ça marche",
    trust: "Aides vérifiées · Approbations révisées par une personne · Conforme à la LPRPDE",
    video: { src: "https://videos.pexels.com/video-files/4499352/4499352-hd_1920_1080_25fps.mp4", credit: "Video: Julia M Cameron / Pexels" },
  },
  benefits: {
    eyebrow: "Pourquoi les familles aiment Poppynz",
    title: "Tout ce qu’il faut pour avoir l’esprit tranquille",
    cards: [
      { file: "shield-family.webp", title: "Vérifiée avant votre rencontre", text: "Pièce d’identité gouvernementale, vérification du secteur vulnérable et vérification approfondie du casier judiciaire, révisées par un membre de l’équipe." },
      { file: "search.webp", title: "Tout près de chez vous", text: "Nous trions par distance : votre aide habite généralement à quelques rues plutôt qu’à l’autre bout de la ville." },
      { file: "earnings.svg", title: "Des tarifs transparents", text: "Chaque service d’un profil affiche son tarif horaire juste à côté, en CAD. Aucun devis à courir après, aucune enchère." },
      { file: "certificate.svg", title: "Des ententes claires", text: "Les heures, le tarif et les attentes sont consignés dans une entente écrite simple avant que quiconque se présente." },
    ],
  },
  profile: {
    eyebrow: "Rencontrez votre aide",
    title: "Tout ce qu’il faut pour choisir en toute confiance",
    lead: "Chaque profil d’aide familiale présente les mêmes éléments, dans le même ordre. Vous ne verrez pas encore de notes en étoiles : nous préférons vous montrer une vraie bio et de vraies vérifications plutôt qu’un chiffre.",
    checks: [
      "<strong>Nom et photo</strong>, prénom et initiale du nom, une vraie photo",
      "<strong>Bio</strong>, dans les mots de l’aide",
      "<strong>Services et tarifs horaires</strong>, chacun indiqué séparément en CAD",
      "<strong>Badge Vérifiée</strong>, affiché seulement après l’approbation d’un membre de l’équipe",
      "<strong>Attestations</strong>, premiers soins, ÉPE, PSSP lorsqu’elles sont détenues",
      "<strong>Distance</strong>, depuis votre domicile, en kilomètres",
    ],
    card: {
      name: "Maria O.",
      vetted: "Vérifiée",
      location: "À 1,2 km · Port Credit, Mississauga",
      bio: "Formée en ÉPE, huit ans auprès de tout-petits et d’enfants d’âge scolaire. J’aime une routine calme après l’école : collation, devoirs, dehors si la pluie le permet.",
      servicesLabel: "Services",
      services: [
        { name: "Garde d’enfants", rate: "28 $/h" },
        { name: "Tutorat (1re à 6e année)", rate: "32 $/h" },
        { name: "Préparation des repas", rate: "26 $/h" },
      ],
      chips: ["Premiers soins", "ÉPE", "Vérification du secteur vulnérable"],
      cta: "Écrire à Maria",
    },
  },
  safety: {
    eyebrow: "La sécurité d’abord",
    title: "Chaque aide franchit", titleAccent: "quatre étapes", titleTail: "avant votre rencontre",
    steps: [
      { n: "01", title: "Identité confirmée", text: "Une pièce d’identité gouvernementale avec photo est associée à la personne et au profil." },
      { n: "02", title: "Antécédents vérifiés", text: "Vérification du secteur vulnérable et vérification approfondie du casier judiciaire, obtenues auprès de Credibled." },
      { n: "03", title: "Attestations validées", text: "Les certificats de premiers soins, d’ÉPE ou de PSSP sont vérifiés lorsqu’une aide les indique." },
      { n: "04", title: "Une personne approuve", text: "Un membre de l’équipe Poppynz examine le dossier complet. Ce n’est qu’ensuite que le badge Vérifiée apparaît." },
    ],
    note: "Vérifications obtenues auprès de notre partenaire Credibled · Conforme à la LPRPDE · Messagerie chiffrée de bout en bout",
    cta: "Lire chaque vérification en langage clair",
  },
  fee: {
    eyebrow: "Une tarification simple et transparente",
    title: "Le tarif de l’aide, plus 5 %. C’est tout!",
    lead: "Pas d’abonnement, pas de frais de réservation, pas de minimum. Les aides familiales fixent leur propre tarif horaire en CAD, et nous ajoutons des frais de service de 5 % qui couvrent les paiements, les ententes et le soutien. Vous voyez toujours le total avant de vous engager.",
    link: "La tarification complète, des deux côtés",
    example: {
      label: "Exemple · 3 heures de garde d’enfants",
      rows: [
        { label: "Tarif de Maria · 28 $/h × 3", amount: "84,00 $" },
        { label: "Frais de service Poppynz · 5 %", amount: "4,20 $" },
      ],
      totalLabel: "Vous payez", total: "88,20 $", currency: "CAD",
    },
  },
  faq: {
    eyebrow: "Foire aux questions",
    title: "Des questions? Nous avons les réponses.",
    lead: `Il manque quelque chose? <a href="mailto:support@poppynz.com"><strong>Écrivez au soutien</strong></a>, une personne vous répond.`,
    items: [
      { q: "Qui sont les aides familiales?", a: "Des gens de votre quartier : souvent des parents, des étudiants, des enseignants à la retraite ou des travailleurs de la santé, qui offrent un coup de main au quotidien près de chez eux. Chacun a passé les vérifications d’identité et d’antécédents et a été approuvé par un membre de l’équipe Poppynz avant d’apparaître dans la recherche." },
      { q: "Pourquoi dois-je faire une vérification de sécurité, moi aussi?", a: "Les aides entrent chez vous. Une courte vérification des familles fait qu’elles n’entendent parler que de foyers réels et vérifiés : c’est ce qui rend la confiance réciproque." },
      { q: "Comment se fait le paiement?", a: "Les séances sont suivies dans l’application et facturées au tarif horaire de l’aide, plus des frais de service de 5 %, en CAD. Il n’y a ni abonnement ni minimum." },
      { q: "Que couvre l’entente écrite?", a: "Les heures, le tarif, ce que le travail comprend, et ce qui arrive si une séance se prolonge ou est annulée. Elle est rédigée en langage clair et signée dans Poppynz avant la première séance." },
      { q: "Puis-je faire appel à la même aide régulièrement?", a: "Oui. C’est ce que font la plupart des familles. Vous pouvez planifier des séances récurrentes avec une aide avec qui vous avez déjà une entente." },
      { q: "Et si quelque chose tourne mal?", a: "Écrivez au soutien depuis l’application, une personne vous répond. Chaque séance, message et entente est consigné, il y a donc un historique clair sur lequel s’appuyer." },
    ],
  },
  cta: {
    title: "Prêt à trouver l’aide idéale?",
    text: "Rejoignez Poppynz dès aujourd’hui et découvrez des aides familiales certifiées près de chez vous.",
    button: "Trouver une aide",
  },
};

export const FAMILIES: Localized<FamiliesContent> = { en, fr };
