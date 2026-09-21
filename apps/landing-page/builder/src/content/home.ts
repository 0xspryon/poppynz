import type { Localized } from "./types";

export type HomeContent = {
  hero: {
    eyebrow: string; title: string; titleHighlight: string; lead: string;
    cardLeft: { title: string; text: string; cta: string }; cardRight: { title: string; text: string; cta: string };
    trust: string; floatCard: { initial: string; name: string; meta: string; vetted: string };
    video: { src: string; poster: string };
  };
  how: { eyebrow: string; title: string; lead: string };
  steps: { n: string; icon: string; title: string; text: string }[];
  safety: {
    eyebrow: string; title: string;
    helpers: { title: string; checks: string[]; optional: string; credibled: string };
    reviewed: { title: string; p1: string; p2: string; note: string };
    families: { title: string; text: string; link: string };
  };
  servicesHeader: { eyebrow: string; title: string; lead: string };
  services: { file: string; name: string; text: string }[];
  quotes: { initial: string; text: string; who: string }[];
  neighbourhood: { eyebrow: string; title: string; lead: string; next: string; note: string; alt: string };
  cities: string[];
  helpers: { eyebrow: string; title: string; titleAccent: string; titleTail: string; lead: string; ctaPrimary: string; ctaSecondary: string; alt: string };
  cta: { title: string; text: string; find: string; become: string };
};

const en: HomeContent = {
  hero: {
    eyebrow: "On-demand Family Support",
    title: "Your Family's", titleHighlight: "Perfect Helper",
    lead: "Connecting busy families with certified Mom Helpers for childcare, meal prep, housekeeping, and more, all background-verified and ready to lend a hand.",
    cardLeft: { title: "I need help", text: "Browse verified Mom Helpers in your area and find the perfect fit for your family.", cta: "Find a helper" },
    cardRight: { title: "I want to help", text: "Set your own services and rates, and support families in your community.", cta: "Become a helper" },
    trust: "Background-checked helpers · PIPEDA-compliant · End-to-end encrypted",
    floatCard: { initial: "M", name: "Maria O.", meta: "Childcare · $28/hr · 1.2 km", vetted: "Vetted" },
    video: { src: "https://videos.pexels.com/video-files/7102352/7102352-hd_1920_1080_30fps.mp4", poster: "https://images.pexels.com/videos/7102352/art-beads-beads-bracelets-building-blocks-7102352.jpeg?auto=compress&w=1260" },
  },
  how: { eyebrow: "How It Works", title: "Getting Started Is Simple", lead: "Here's how you can find the perfect Mom Helper for your family, no bidding, no surge pricing, just a clear hourly rate agreed in writing." },
  steps: [
    { n: "01", icon: "clipboard-list", title: "Create Your Account", text: "Sign up as a family with a magic link and tell us about your household and care needs. A quick safety check lets helpers know you're verified too." },
    { n: "02", icon: "map-marked-alt", title: "Find Your Perfect Helper", text: "Browse profiles of verified Mom Helpers in your area, photo, bio, services with hourly rates, distance, and the Vetted badge." },
    { n: "03", icon: "file-signature", title: "Schedule Your Service", text: "Connect with your helper, book on-demand or regular help, and put the details into a simple written agreement." },
    { n: "04", icon: "stopwatch", title: "Simple Payment", text: "Enjoy secure, automated payments after each session based on the helper's rate, plus a 5% service fee. That's it!" },
  ],
  safety: {
    eyebrow: "Trusted Care, Both Ways",
    title: "Peace of mind for families, and dignity for helpers. Every Mom Helper is verified before you can find them, and every family is verified before helpers can find you.",
    helpers: { title: "Verified Helpers", checks: ["Government photo ID", "Vulnerable Sector Check", "Enhanced criminal record check"], optional: "Optional: First Aid, ECE, PSW credentials", credibled: "Record checks fetched through our partner <strong>Credibled</strong>" },
    reviewed: { title: "Reviewed by Real People", p1: "Before a helper appears in search, a member of the Poppynz team personally reviews their documents. Automated checks help us along, but a real person makes the call.", p2: "Know someone who'd make a great Mom Helper? Members can refer them, and referrals go through the very same review.", note: "PIPEDA-compliant · End-to-end encrypted messaging" },
    families: { title: "Verified Families", text: "Before a helper can see your profile, you'll complete a short safety check. That way, helpers only ever hear from verified families.", link: "Learn about our safety checks" },
  },
  servicesHeader: { eyebrow: "What We Offer", title: "Support for Every Part of Family Life", lead: "Mom Helpers list the services they offer along with their hourly rate. Need something a little different? Helpers can offer custom services too." },
  services: [
    { file: "childcare", name: "Childcare", text: "Quality care for your children in your home, tailored to their age and interests." },
    { file: "tutoring", name: "Tutoring", text: "Academic support and homework help for students of all ages." },
    { file: "elderly-check-in", name: "Elderly check-in", text: "Compassionate check-ins for elderly family members, for peace of mind." },
    { file: "pet-minding", name: "Pet minding", text: "Caring attention for your furry family members, feeding, walking, and playtime." },
    { file: "meal-preparation", name: "Meal preparation", text: "Nutritious meals prepared fresh in your kitchen, to your family's tastes." },
    { file: "light-housekeeping", name: "Light housekeeping", text: "Keeping your living space tidy, from vacuuming to laundry and dishes." },
    { file: "yard-help", name: "Yard help", text: "From weeding to light clean-ups, we keep your yard neat and tidy." },
    { file: "packages", name: "Small errands", text: "Out when a delivery arrives? Helpers bring in packages, water plants, and take out the rubbish!" },
  ],
  quotes: [
    { initial: "SJ", text: `"The daycare matching service helped us find a spot within a week after months of searching on our own. Worth every penny!"`, who: "Sarah Johnson · Working Mom" },
    { initial: "ER", text: `"The daycare matching service helped us find a spot within a week after months of searching on our own. Worth every penny!"`, who: "Emma Rodriguez · Parent of Three" },
    { initial: "MC", text: `"The meal prep service has been a game-changer for our busy household. I can finally enjoy quality time with my kids without stressing about dinner."`, who: "Michael Chen · Single Dad" },
  ],
  neighbourhood: { eyebrow: "Poppynz in Your Neighbourhood", title: "Trusted Help, Right Around the Corner", lead: "We match you with Mom Helpers by distance, so the person watering your plants or walking your dog is usually just a few blocks away, a trusted neighbour, ready when you need them.", next: "Your city next?", note: "All prices in CAD. Data handled under PIPEDA.", alt: "Front porch, residential Canadian street" },
  cities: ["Mississauga", "Toronto", "Ottawa", "Calgary", "Vancouver"],
  helpers: { eyebrow: "For helpers", title: "Earn Flexibly.", titleAccent: "Support", titleTail: "Your Community.", lead: "Become a Mom Helper and earn income on your own schedule. Set your services and hourly rate in CAD, work when and where you choose, and keep 85% of what you earn. Experienced helpers can grow into Major-domo status.", ctaPrimary: "Become a helper", ctaSecondary: "See what's required", alt: "Tutor and student at a kitchen table" },
  cta: { title: "Ready to Find Your Perfect Helper?", text: "Join Poppynz today and connect with certified Mom Helpers in your area. Sign in with a magic link, no password needed.", find: "Find a helper", become: "Become a helper" },
};

const fr: HomeContent = {
  hero: {
    eyebrow: "Soutien familial à la demande",
    title: "L'aide idéale pour", titleHighlight: "votre famille",
    lead: "Nous mettons en contact les familles occupées avec des aides familiales certifiées pour la garde d'enfants, la préparation des repas, l'entretien ménager et plus encore, toutes vérifiées et prêtes à donner un coup de main.",
    cardLeft: { title: "J'ai besoin d'aide", text: "Parcourez les aides familiales vérifiées de votre quartier et trouvez la personne idéale pour votre famille.", cta: "Trouver une aide" },
    cardRight: { title: "Je veux aider", text: "Définissez vos services et vos tarifs, et soutenez les familles de votre communauté.", cta: "Devenir aide familiale" },
    trust: "Aides vérifiées · Conforme à la LPRPDE · Chiffrement de bout en bout",
    floatCard: { initial: "M", name: "Maria O.", meta: "Garde d'enfants · 28 $/h · 1,2 km", vetted: "Vérifiée" },
    video: { src: "https://videos.pexels.com/video-files/7102352/7102352-hd_1920_1080_30fps.mp4", poster: "https://images.pexels.com/videos/7102352/art-beads-beads-bracelets-building-blocks-7102352.jpeg?auto=compress&w=1260" },
  },
  how: { eyebrow: "Comment ça marche", title: "Commencer, c'est simple", lead: "Voici comment trouver l'aide familiale idéale pour votre famille : pas d'enchères, pas de tarification dynamique, juste un tarif horaire clair convenu par écrit." },
  steps: [
    { n: "01", icon: "clipboard-list", title: "Créez votre compte", text: "Inscrivez-vous comme famille avec un lien magique et parlez-nous de votre foyer et de vos besoins. Une courte vérification de sécurité indique aux aides que vous êtes vérifiés aussi." },
    { n: "02", icon: "map-marked-alt", title: "Trouvez l'aide idéale", text: "Parcourez les profils d'aides familiales vérifiées près de chez vous : photo, bio, services et tarifs horaires, distance et badge Vérifiée." },
    { n: "03", icon: "file-signature", title: "Planifiez le service", text: "Entrez en contact avec votre aide, réservez une aide ponctuelle ou régulière, et consignez les détails dans une entente écrite simple." },
    { n: "04", icon: "stopwatch", title: "Paiement simple", text: "Profitez de paiements sécurisés et automatisés après chaque séance, selon le tarif de l'aide, plus des frais de service de 5 %. C'est tout!" },
  ],
  safety: {
    eyebrow: "Une confiance réciproque",
    title: "La tranquillité d'esprit pour les familles, la dignité pour les aides. Chaque aide familiale est vérifiée avant d'apparaître dans vos résultats, et chaque famille est vérifiée avant que les aides puissent la trouver.",
    helpers: { title: "Aides vérifiées", checks: ["Pièce d'identité gouvernementale avec photo", "Vérification du secteur vulnérable", "Vérification approfondie du casier judiciaire"], optional: "Facultatif : premiers soins, ÉPE, PSSP", credibled: "Vérifications obtenues auprès de notre partenaire <strong>Credibled</strong>" },
    reviewed: { title: "Révisé par de vraies personnes", p1: "Avant qu'une aide apparaisse dans la recherche, un membre de l'équipe Poppynz examine personnellement ses documents. Les vérifications automatisées nous aident, mais c'est une personne qui décide.", p2: "Vous connaissez quelqu'un qui ferait une excellente aide familiale? Les membres peuvent le recommander, et les recommandations passent par la même révision.", note: "Conforme à la LPRPDE · Messagerie chiffrée de bout en bout" },
    families: { title: "Familles vérifiées", text: "Avant qu'une aide puisse voir votre profil, vous effectuez une courte vérification de sécurité. Ainsi, les aides n'entendent parler que de familles vérifiées.", link: "En savoir plus sur nos vérifications" },
  },
  servicesHeader: { eyebrow: "Ce que nous offrons", title: "Un soutien pour chaque facette de la vie de famille", lead: "Les aides familiales indiquent les services qu'elles offrent ainsi que leur tarif horaire. Besoin de quelque chose d'un peu différent? Elles peuvent aussi proposer des services sur mesure." },
  services: [
    { file: "childcare", name: "Garde d'enfants", text: "Des soins de qualité pour vos enfants, à la maison, adaptés à leur âge et à leurs intérêts." },
    { file: "tutoring", name: "Tutorat", text: "Soutien scolaire et aide aux devoirs pour les élèves de tous âges." },
    { file: "elderly-check-in", name: "Visites aux aînés", text: "Des visites bienveillantes auprès des membres âgés de la famille, pour votre tranquillité d'esprit." },
    { file: "pet-minding", name: "Garde d'animaux", text: "Une attention affectueuse pour vos compagnons à quatre pattes : repas, promenades et jeux." },
    { file: "meal-preparation", name: "Préparation des repas", text: "Des repas nutritifs préparés dans votre cuisine, au goût de votre famille." },
    { file: "light-housekeeping", name: "Entretien ménager léger", text: "Un espace de vie en ordre : aspirateur, lessive et vaisselle." },
    { file: "yard-help", name: "Aide au jardin", text: "Du désherbage au petit nettoyage, votre cour reste nette et soignée." },
    { file: "packages", name: "Petites courses", text: "Absent lors d'une livraison? Les aides rentrent les colis, arrosent les plantes et sortent les poubelles!" },
  ],
  quotes: [
    { initial: "SJ", text: "« Le service de jumelage garderie nous a trouvé une place en une semaine, après des mois de recherche. Ça vaut chaque dollar! »", who: "Sarah Johnson · Maman au travail" },
    { initial: "ER", text: "« Le service de jumelage garderie nous a trouvé une place en une semaine, après des mois de recherche. Ça vaut chaque dollar! »", who: "Emma Rodriguez · Mère de trois enfants" },
    { initial: "MC", text: "« La préparation des repas a changé la donne pour notre famille occupée. Je profite enfin de mes enfants sans stresser pour le souper. »", who: "Michael Chen · Père monoparental" },
  ],
  neighbourhood: { eyebrow: "Poppynz dans votre quartier", title: "Une aide de confiance, tout près de chez vous", lead: "Nous vous jumelons avec des aides familiales selon la distance : la personne qui arrose vos plantes ou promène votre chien habite souvent à quelques rues, une voisine de confiance, prête quand vous en avez besoin.", next: "Votre ville ensuite?", note: "Tous les prix en CAD. Données traitées selon la LPRPDE.", alt: "Perron d'une rue résidentielle canadienne" },
  cities: ["Mississauga", "Toronto", "Ottawa", "Calgary", "Vancouver"],
  helpers: { eyebrow: "Pour les aides", title: "Gagnez avec souplesse.", titleAccent: "Soutenez", titleTail: "votre communauté.", lead: "Devenez aide familiale et gagnez un revenu selon votre horaire. Définissez vos services et votre tarif horaire en CAD, travaillez quand et où vous le voulez, et conservez 85 % de vos gains. Les aides expérimentées peuvent accéder au statut de Major-domo.", ctaPrimary: "Devenir aide familiale", ctaSecondary: "Voir les conditions", alt: "Tutrice et élève à une table de cuisine" },
  cta: { title: "Prêt à trouver l'aide idéale?", text: "Rejoignez Poppynz dès aujourd'hui et entrez en contact avec des aides familiales certifiées près de chez vous. Connexion par lien magique, sans mot de passe.", find: "Trouver une aide", become: "Devenir aide familiale" },
};

export const HOME: Localized<HomeContent> = { en, fr };
