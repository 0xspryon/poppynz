import type { Localized } from "./types";

export type SafetyContent = {
  hero: {
    eyebrow: string; title: string; lead: string; nav: string[];
    card: {
      label: string; vetted: string;
      rows: { icon: string; label: string; chip: string; kind: "ok" | "info" }[];
      note: string;
    };
  };
  checks: {
    eyebrow: string; title: string;
    cards: { chip: string; kind: "req" | "info"; file: string; title: string; what: string; why: string }[];
  };
  credibled: { eyebrow: string; title: string; lead: string; points: string[] };
  review: {
    eyebrow: string; title: string; titleAccent: string; lead1: string; lead2: string;
    steps: { n: string; title: string; text: string }[];
  };
  families: { eyebrow: string; title: string; lead: string; checks: string[]; alt: string; credit: string };
  data: { eyebrow: string; title: string; cards: { icon: string; title: string; text: string }[] };
  never: { eyebrow: string; title: string; items: string[] };
  cta: { title: string; text: string; primary: string; secondary: string };
};

const en: SafetyContent = {
  hero: {
    eyebrow: "Safety & trust",
    title: "Your Safety Is Our Priority",
    lead: "We prioritize safety and trust for everyone on Poppynz, with rigorous background checks for all Mom Helpers and verification for every family. Here’s exactly what we check, explained in plain language.",
    nav: ["Helper Verification", "Family verification", "Human review", "Your Privacy", "Our Promise to You"],
    card: {
      label: "Verification status",
      vetted: "Vetted",
      rows: [
        { icon: "id-card", label: "Government ID", chip: "Verified", kind: "ok" },
        { icon: "user-shield", label: "Vulnerable Sector Check", chip: "Clear", kind: "ok" },
        { icon: "file-alt", label: "Enhanced record check", chip: "Clear · Credibled", kind: "ok" },
        { icon: "first-aid", label: "First Aid / CPR", chip: "Verified", kind: "ok" },
        { icon: "graduation-cap", label: "ECE", chip: "Optional", kind: "info" },
      ],
      note: "Reviewed by a Poppynz admin · 14 Sept 2026",
    },
  },
  checks: {
    eyebrow: "Helper Verification",
    title: "Every Mom Helper Is Background-Checked",
    cards: [
      {
        chip: "Required", kind: "req", file: "verified-profile.svg", title: "Government photo ID",
        what: "<strong>What it is.</strong> A passport, driver’s licence or provincial photo card, matched to the helper’s face and legal name.",
        why: "<strong>Why we ask.</strong> So the person on the profile is the person at your door, and so every other check is tied to a real identity.",
      },
      {
        chip: "Required", kind: "req", file: "approved.svg", title: "Vulnerable Sector Check",
        what: "<strong>What it is.</strong> A police check specifically for people who will work with children or vulnerable adults. It includes records a standard check does not.",
        why: "<strong>Why we ask.</strong> Childcare and elderly check-ins are exactly the roles this check was designed for.",
      },
      {
        chip: "Required", kind: "req", file: "certificate.svg", title: "Enhanced criminal record check",
        what: "<strong>What it is.</strong> A national criminal record search, fetched securely through our partner Credibled.",
        why: "<strong>Why we ask.</strong> It covers what the Vulnerable Sector Check doesn’t and gives the admin a complete picture.",
      },
      {
        chip: "Optional", kind: "info", file: "first-aid.svg", title: "First Aid / CPR",
        what: "<strong>What it is.</strong> A current certificate from a recognised provider, verified by an admin.",
        why: "<strong>Why we ask.</strong> Shown as a tag on the profile so families can choose helpers who hold it.",
      },
      {
        chip: "Optional", kind: "info", file: "ece.svg", title: "Early Childhood Educator (ECE)",
        what: "<strong>What it is.</strong> A diploma or provincial registration in early childhood education.",
        why: "<strong>Why we ask.</strong> Useful for families seeking structured childcare or tutoring for younger children.",
      },
      {
        chip: "Optional", kind: "info", file: "psw.svg", title: "Personal Support Worker (PSW)",
        what: "<strong>What it is.</strong> A PSW certificate from a recognised program.",
        why: "<strong>Why we ask.</strong> Relevant for elderly check-ins and families caring for an older relative.",
      },
    ],
  },
  credibled: {
    eyebrow: "Our background-check partner",
    title: "Record checks are fetched through Credibled.",
    lead: "Credibled is a Canadian background-screening provider. When a helper requests their checks from inside Poppynz, Credibled runs the enhanced criminal record check and coordinates the Vulnerable Sector Check with the relevant police service. The result is returned to a Poppynz admin, never posted to a profile, never shown to families.",
    points: [
      "Requested by the helper from inside Poppynz, no station visit for the record check",
      "Consent is given by the helper each time; nothing is fetched without it",
      "Results are seen by a Poppynz admin only, never by families",
      "Credibled’s own privacy policy applies to their processing; ours applies to everything else",
    ],
  },
  review: {
    eyebrow: "Reviewed by Real People",
    title: "Every Approval Is Reviewed by a", titleAccent: "Real Person",
    lead1: "Automated checks confirm that documents are real and match up. Then someone on our team reads the whole file. ID, checks, credentials, profile, and makes the call. If anything is unclear, we simply ask the helper first. The Vetted badge is only ever given by a person.",
    lead2: "Referrals work the same way. A member can vouch for someone they know, which opens the door; it does not skip a single check.",
    steps: [
      { n: "01", title: "Documents arrive", text: "ID, checks and any credentials land in the admin queue." },
      { n: "02", title: "Match and read", text: "The admin confirms names and photos match, and reads each result in full." },
      { n: "03", title: "Ask if unclear", text: "Anything ambiguous goes back to the helper as a question, not a rejection." },
      { n: "04", title: "Approve, or not", text: "Only an admin can set the Vetted badge. Approvals are logged with who reviewed and when." },
    ],
  },
  families: {
    eyebrow: "Verified Families",
    title: "Verified Families. We think helpers deserve that.",
    lead: "A helper is walking into someone’s home, often for the first time. So before a family can find or message anyone, we ask them to complete a short safety check, identity and a few household details. That way helpers only ever hear from verified families.",
    checks: [
      "Identity confirmed with a government ID",
      "Home address confirmed, it sets the distance helpers see",
      "Household details: who’s at home, pets, anything a helper should know",
      "Every agreement is signed in writing, by both sides, before the first session",
    ],
    alt: "Parent at the front door greeting a helper",
    credit: "Photo by Picsea on Unsplash",
  },
  data: {
    eyebrow: "Your Privacy",
    title: "Your Information Is Safe With Us",
    cards: [
      { icon: "lock", title: "End-to-end encrypted messaging", text: "Conversations between families and helpers are encrypted in transit and at rest." },
      { icon: "balance-scale", title: "PIPEDA-compliant", text: "We follow Canada’s federal privacy law: collect only what we need, say why, and let you access or delete it." },
      { icon: "envelope-open-text", title: "Passwordless sign-in", text: "A magic link by email. No password to reuse, leak or forget." },
      { icon: "eye-slash", title: "Check results stay private", text: "Background-check documents are visible to admins only. Families see the Vetted badge and credential tags, never the files." },
    ],
  },
  never: {
    eyebrow: "Our Promise to You",
    title: "Things We Will Never Do",
    items: [
      "Approve a helper without a human admin reviewing their file",
      "Show a family the contents of a background check",
      "Sell or share your personal data with advertisers",
      "Let an unverified family message a helper",
      "Publish ratings or reviews we haven’t collected, the product has none yet, so you won’t see any",
      "Change the rate on a signed agreement",
    ],
  },
  cta: {
    title: "Have Questions About Safety?",
    text: "We’d love to hear from you. Reach our trust team at support@poppynz.com, or get started today.",
    primary: "Get started",
    secondary: "Contact the trust team",
  },
};

// French copy follows the terminology already established in content/home.ts and content/footer.ts:
// "aide familiale", badge "Vérifiée", "vérification du secteur vulnérable", "entente écrite",
// "séance", "LPRPDE", "ÉPE" / "PSSP", "lien magique". No-break spaces (U+00A0) sit before the
// colons, semicolons and question marks that French typography spaces out, and inside the
// guillemets — the headless render is how a missing one shows up (see poppynz.md § French copy).
const fr: SafetyContent = {
  hero: {
    eyebrow: "Sécurité et confiance",
    title: "Votre sécurité est notre priorité",
    lead: "Nous accordons la priorité à la sécurité et à la confiance pour tout le monde sur Poppynz : vérification rigoureuse des antécédents pour chaque aide familiale, et vérification de chaque famille. Voici exactement ce que nous vérifions, expliqué en langage clair.",
    nav: ["Vérification des aides", "Vérification des familles", "Révision humaine", "Votre vie privée", "Notre promesse"],
    card: {
      label: "État de la vérification",
      vetted: "Vérifiée",
      rows: [
        { icon: "id-card", label: "Pièce d’identité", chip: "Vérifiée", kind: "ok" },
        { icon: "user-shield", label: "Vérification du secteur vulnérable", chip: "Aucun dossier", kind: "ok" },
        { icon: "file-alt", label: "Vérification approfondie", chip: "Aucun dossier · Credibled", kind: "ok" },
        { icon: "first-aid", label: "Premiers soins / RCR", chip: "Vérifiée", kind: "ok" },
        { icon: "graduation-cap", label: "ÉPE", chip: "Facultatif", kind: "info" },
      ],
      note: "Révisé par un admin Poppynz · 14 sept. 2026",
    },
  },
  checks: {
    eyebrow: "Vérification des aides",
    title: "Chaque aide familiale fait l’objet d’une vérification des antécédents",
    cards: [
      {
        chip: "Requis", kind: "req", file: "verified-profile.svg", title: "Pièce d’identité gouvernementale avec photo",
        what: "<strong>Ce que c’est.</strong> Un passeport, un permis de conduire ou une carte d’identité provinciale avec photo, comparé au visage et au nom légal de l’aide.",
        why: "<strong>Pourquoi nous la demandons.</strong> Pour que la personne du profil soit bien celle qui se présente chez vous, et pour que toutes les autres vérifications soient rattachées à une identité réelle.",
      },
      {
        chip: "Requis", kind: "req", file: "approved.svg", title: "Vérification du secteur vulnérable",
        what: "<strong>Ce que c’est.</strong> Une vérification policière destinée aux personnes qui travailleront auprès d’enfants ou d’adultes vulnérables. Elle couvre des dossiers qu’une vérification ordinaire ne couvre pas.",
        why: "<strong>Pourquoi nous la demandons.</strong> La garde d’enfants et les visites aux aînés sont exactement les rôles pour lesquels cette vérification a été conçue.",
      },
      {
        chip: "Requis", kind: "req", file: "certificate.svg", title: "Vérification approfondie du casier judiciaire",
        what: "<strong>Ce que c’est.</strong> Une recherche nationale au casier judiciaire, obtenue de façon sécurisée auprès de notre partenaire Credibled.",
        why: "<strong>Pourquoi nous la demandons.</strong> Elle couvre ce que la vérification du secteur vulnérable ne couvre pas et donne à l’admin un portrait complet.",
      },
      {
        chip: "Facultatif", kind: "info", file: "first-aid.svg", title: "Premiers soins / RCR",
        what: "<strong>Ce que c’est.</strong> Un certificat à jour délivré par un fournisseur reconnu, vérifié par un admin.",
        why: "<strong>Pourquoi nous la demandons.</strong> Affiché comme étiquette sur le profil, pour que les familles puissent choisir des aides qui le détiennent.",
      },
      {
        chip: "Facultatif", kind: "info", file: "ece.svg", title: "Éducatrice de la petite enfance (ÉPE)",
        what: "<strong>Ce que c’est.</strong> Un diplôme ou une inscription provinciale en éducation à la petite enfance.",
        why: "<strong>Pourquoi nous la demandons.</strong> Utile pour les familles qui cherchent une garde structurée ou du tutorat pour de jeunes enfants.",
      },
      {
        chip: "Facultatif", kind: "info", file: "psw.svg", title: "Préposée aux services de soutien à la personne (PSSP)",
        what: "<strong>Ce que c’est.</strong> Un certificat de PSSP obtenu dans un programme reconnu.",
        why: "<strong>Pourquoi nous la demandons.</strong> Pertinent pour les visites aux aînés et les familles qui prennent soin d’un proche âgé.",
      },
    ],
  },
  credibled: {
    eyebrow: "Notre partenaire de vérification",
    title: "Les vérifications sont obtenues auprès de Credibled.",
    lead: "Credibled est un fournisseur canadien de vérification des antécédents. Lorsqu’une aide demande ses vérifications depuis Poppynz, Credibled effectue la vérification approfondie du casier judiciaire et coordonne la vérification du secteur vulnérable avec le service de police concerné. Le résultat est transmis à un admin Poppynz, jamais publié sur un profil, jamais montré aux familles.",
    points: [
      "Demandée par l’aide depuis Poppynz, sans visite au poste pour la vérification du casier",
      "Le consentement est donné par l’aide chaque fois; rien n’est obtenu sans lui",
      "Les résultats ne sont vus que par un admin Poppynz, jamais par les familles",
      "La politique de confidentialité de Credibled s’applique à son traitement; la nôtre s’applique à tout le reste",
    ],
  },
  review: {
    eyebrow: "Révisé par de vraies personnes",
    title: "Chaque approbation est révisée par une", titleAccent: "vraie personne",
    lead1: "Les vérifications automatisées confirment que les documents sont authentiques et concordants. Ensuite, une personne de notre équipe lit le dossier au complet : identité, vérifications, qualifications, profil, et tranche. Si quelque chose n’est pas clair, nous posons simplement la question à l’aide. Le badge Vérifiée n’est jamais accordé autrement que par une personne.",
    lead2: "Les recommandations fonctionnent de la même façon. Un membre peut se porter garant de quelqu’un qu’il connaît, ce qui ouvre la porte; cela ne fait sauter aucune vérification.",
    steps: [
      { n: "01", title: "Les documents arrivent", text: "L’identité, les vérifications et les qualifications arrivent dans la file de l’admin." },
      { n: "02", title: "Comparer et lire", text: "L’admin confirme que les noms et les photos concordent, et lit chaque résultat au complet." },
      { n: "03", title: "Demander si c’est ambigu", text: "Tout élément ambigu revient à l’aide sous forme de question, pas de refus." },
      { n: "04", title: "Approuver, ou non", text: "Seul un admin peut accorder le badge Vérifiée. Les approbations sont consignées avec le nom du réviseur et la date." },
    ],
  },
  families: {
    eyebrow: "Familles vérifiées",
    title: "Familles vérifiées. Les aides le méritent aussi.",
    lead: "Une aide entre chez quelqu’un, souvent pour la première fois. Avant qu’une famille puisse trouver ou contacter qui que ce soit, nous lui demandons donc une courte vérification de sécurité : son identité et quelques détails sur le foyer. Ainsi, les aides n’entendent parler que de familles vérifiées.",
    checks: [
      "Identité confirmée avec une pièce d’identité gouvernementale",
      "Adresse du domicile confirmée, elle détermine la distance que voient les aides",
      "Détails du foyer : qui s’y trouve, les animaux, tout ce qu’une aide devrait savoir",
      "Chaque entente est signée par écrit, par les deux parties, avant la première séance",
    ],
    alt: "Parent accueillant une aide à la porte",
    credit: "Photo by Picsea on Unsplash",
  },
  data: {
    eyebrow: "Votre vie privée",
    title: "Vos renseignements sont en sécurité avec nous",
    cards: [
      { icon: "lock", title: "Messagerie chiffrée de bout en bout", text: "Les conversations entre les familles et les aides sont chiffrées en transit et au repos." },
      { icon: "balance-scale", title: "Conforme à la LPRPDE", text: "Nous suivons la loi fédérale canadienne sur la vie privée : ne recueillir que le nécessaire, dire pourquoi, et vous laisser y accéder ou les supprimer." },
      { icon: "envelope-open-text", title: "Connexion sans mot de passe", text: "Un lien magique par courriel. Aucun mot de passe à réutiliser, à faire fuir ou à oublier." },
      { icon: "eye-slash", title: "Les résultats restent privés", text: "Les documents de vérification ne sont visibles que par les admins. Les familles voient le badge Vérifiée et les étiquettes de qualification, jamais les fichiers." },
    ],
  },
  never: {
    eyebrow: "Notre promesse",
    title: "Ce que nous ne ferons jamais",
    items: [
      "Approuver une aide sans qu’un admin humain ait révisé son dossier",
      "Montrer à une famille le contenu d’une vérification des antécédents",
      "Vendre ou partager vos renseignements personnels avec des annonceurs",
      "Laisser une famille non vérifiée écrire à une aide",
      "Publier des notes ou des avis que nous n’avons pas recueillis; le produit n’en a aucun, vous n’en verrez donc pas",
      "Changer le tarif d’une entente signée",
    ],
  },
  cta: {
    title: "Des questions sur la sécurité?",
    text: "Nous aimerions vous lire. Écrivez à notre équipe de confiance à support@poppynz.com, ou commencez dès aujourd’hui.",
    primary: "Commencer",
    secondary: "Écrire à l’équipe de confiance",
  },
};

export const SAFETY: Localized<SafetyContent> = { en, fr };
