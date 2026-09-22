import type { Localized } from "./types";

/**
 * Copy for the three legal documents — Privacy Policy, Terms of Service and Service Agreement.
 * All three share one shape (a titled, numbered list of sections), so one recipe builds all six
 * pages from this file; see `recipes/legal.ts`.
 *
 * The English text is transcribed verbatim from apps/landing-page/design/{privacy-policy,
 * terms-of-service,service-agreement}.html, including the design's own section numbering, its
 * "1.1"-style item prefixes in the Service Agreement, and its straight quotes around defined
 * terms. The French text is written here, using the terminology already established in
 * content/home.ts, content/footer.ts and content/helpers.ts ("aide familiale", "garderie",
 * "seance", "courriel", "LPRPDE" for PIPEDA). French strings contain literal U+00A0 no-break
 * spaces inside guillemets and before "%", exactly as content/helpers.ts does — without them a
 * closing guillemet or a percent sign can drop onto a line of its own.
 */

export type LegalDocKey = "privacy" | "terms" | "agreement";
export const LEGAL_DOCS: LegalDocKey[] = ["privacy", "terms", "agreement"];

/** A named group of list items inside one section (the design's `.legal-sub`). */
export type LegalSub = { title: string; items: string[] };

/**
 * One numbered block (the design's `.legal-sec`). `n` is the pill the design prints beside the
 * heading, or null for a section the design leaves unnumbered (the Privacy Policy's closing
 * "Key Considerations for Canadian Privacy"). Every other field is optional because the designs
 * use them in different combinations: a lead paragraph, named sub-lists, a flat tick list, and a
 * closing emphasised line.
 */
export type LegalSection = {
  n: string | null;
  title: string;
  lead?: string;
  subs?: LegalSub[];
  items?: string[];
  tail?: string;
};

export type LegalDoc = {
  /** The h1, and the label of this document's pill in the three-way tab switcher. */
  title: string;
  intro: string;
  /** "Last updated ..." for the policies, "Effective date: ..." for the agreement. */
  note: string;
  sections: LegalSection[];
};

/** The chrome every legal page shares, independent of which document is being shown. */
export type LegalCommon = { eyebrow: string; tocLabel: string; contact: string; contactEmail: string };


const privacyEn: LegalDoc = {
  title: "Privacy Policy",
  intro: "How we collect, use, disclose and safeguard your information when you use the Poppynz website and app.",
  note: "Last updated 18 September 2026",
  sections: [
    {
      n: "1",
      title: "Introduction",
      lead: "Poppynz Inc. (\"Poppynz,\" \"we,\" \"us,\" or \"our\") is committed to protecting the privacy of your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our website and mobile application (collectively, \"the Platform\"). By using the Platform, you consent to the practices described in this Privacy Policy.",
    },
    {
      n: "2",
      title: "Information We Collect",
      subs: [
        {
          title: "Information you provide directly",
          items: [
            "Account Information: Name, email address, phone number, postal code, and profile information.",
            "Payment Information: Credit card details or other payment information (processed by third-party payment processors).",
            "Background Check and Certification Information: Driver's license, passport, police check, first aid certification, and other required documents.",
            "Daycare Information: Daycare name, address, available spots, and contact information.",
            "Daycare interest list information: Name, address, postal code, number of children, and desired start date.",
            "Communications: Correspondence with us, including customer support inquiries.",
          ],
        },
        {
          title: "Information we collect automatically",
          items: [
            "Usage Data: Information about how you use the Platform, including app usage, pages visited, and features used.",
            "Device Information: IP address, device type, operating system, and browser type.",
            "Location Information: If you enable location services, we may collect your device's location.",
            "Cookies and Tracking Technologies: We may use cookies and similar technologies to collect information about your browsing activities.",
          ],
        },
      ],
    },
    {
      n: "3",
      title: "How We Use Your Information",
      items: [
        "To provide and maintain the Platform.",
        "To process payments and manage accounts.",
        "To conduct background checks and verify certifications.",
        "To connect parents with Mom Helpers and daycares.",
        "To communicate with you, including sending notifications and updates.",
        "To improve and personalize your experience.",
        "To analyze usage data and trends.",
        "To comply with legal obligations.",
        "To compile the daycare spot interest list, and notify users of available spots.",
        "To allow daycares to advertise available spots.",
      ],
    },
    {
      n: "4",
      title: "Disclosure of Your Information",
      items: [
        "Mom Helpers and Parents: We share necessary information between parents and Mom Helpers to facilitate service provision.",
        "Daycares and Parents: We share necessary information between parents and daycares to facilitate service provision.",
        "Third-Party Service Providers: We may share information with third-party service providers that assist us with payment processing, background checks, data analysis, and other services.",
        "Legal Compliance: We may disclose information if required by law or to protect our rights.",
        "Business Transfers: In the event of a merger, acquisition, or sale of assets, your information may be transferred.",
      ],
    },
    {
      n: "5",
      title: "Data Security",
      items: [
        "We implement reasonable security measures to protect your information.",
        "However, no method of transmission over the internet or electronic storage is completely secure.",
      ],
    },
    {
      n: "6",
      title: "Data Retention",
      lead: "We retain your information for as long as necessary to provide services and comply with legal obligations.",
    },
    {
      n: "7",
      title: "Your Rights",
      items: [
        "You may access, correct, or delete your personal information by accessing your account settings or contacting us.",
        "You may opt out of receiving promotional communications.",
        "You may request information on how your data is being used.",
        "Canadian users have specific rights under PIPEDA, and provincial privacy laws.",
      ],
    },
    {
      n: "8",
      title: "Children's Privacy",
      lead: "The Platform is not intended for children under the age of 13. We do not knowingly collect personal information from children under 13.",
    },
    {
      n: "9",
      title: "Changes to This Privacy Policy",
      lead: "We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on the Platform.",
    },
    {
      n: "10",
      title: "Contact Us",
      lead: "If you have any questions or concerns about this Privacy Policy, please contact us at service@poppynz.com.",
    },
    {
      n: null,
      title: "Key Considerations for Canadian Privacy",
      items: [
        "PIPEDA Compliance: Our practices comply with the Personal Information Protection and Electronic Documents Act (PIPEDA) and applicable provincial privacy laws.",
        "Consent: We obtain clear and informed consent for the collection, use, and disclosure of personal information.",
        "Data Minimization: We only collect the personal information that is necessary for the identified purposes.",
        "Data Security: We implement appropriate safeguards to protect personal information from unauthorized access, use, or disclosure.",
        "Accountability: We designate a privacy officer responsible for overseeing compliance with privacy laws.",
        "Cross-Border Transfers: If transferring personal information outside of Canada, we ensure appropriate safeguards are in place.",
      ],
    },
  ],
};

const privacyFr: LegalDoc = {
  title: "Politique de confidentialité",
  intro: "Comment nous recueillons, utilisons, communiquons et protégeons vos renseignements lorsque vous utilisez le site Web et l’application Poppynz.",
  note: "Dernière mise à jour le 18 septembre 2026",
  sections: [
    {
      n: "1",
      title: "Introduction",
      lead: "Poppynz Inc. (« Poppynz », « nous » ou « notre ») s’engage à protéger la confidentialité de vos renseignements personnels. La présente politique de confidentialité explique comment nous recueillons, utilisons, communiquons et protégeons vos renseignements lorsque vous utilisez notre site Web et notre application mobile (collectivement, « la Plateforme »). En utilisant la Plateforme, vous consentez aux pratiques décrites dans la présente politique de confidentialité.",
    },
    {
      n: "2",
      title: "Renseignements que nous recueillons",
      subs: [
        {
          title: "Renseignements que vous fournissez directement",
          items: [
            "Renseignements de compte : nom, adresse courriel, numéro de téléphone, code postal et renseignements de profil.",
            "Renseignements de paiement : numéro de carte de crédit ou autres renseignements de paiement (traités par des fournisseurs de paiement tiers).",
            "Renseignements de vérification et de certification : permis de conduire, passeport, vérification policière, certification en secourisme et autres documents exigés.",
            "Renseignements sur la garderie : nom de la garderie, adresse, places disponibles et coordonnées.",
            "Renseignements de la liste d’intérêt pour une place en garderie : nom, adresse, code postal, nombre d’enfants et date de début souhaitée.",
            "Communications : correspondance avec nous, y compris les demandes au service à la clientèle.",
          ],
        },
        {
          title: "Renseignements que nous recueillons automatiquement",
          items: [
            "Données d’utilisation : renseignements sur votre façon d’utiliser la Plateforme, y compris l’utilisation de l’application, les pages visitées et les fonctionnalités utilisées.",
            "Renseignements sur l’appareil : adresse IP, type d’appareil, système d’exploitation et type de navigateur.",
            "Renseignements de localisation : si vous activez les services de localisation, nous pouvons recueillir la position de votre appareil.",
            "Témoins et technologies de suivi : nous pouvons utiliser des témoins et des technologies similaires pour recueillir des renseignements sur vos activités de navigation.",
          ],
        },
      ],
    },
    {
      n: "3",
      title: "Comment nous utilisons vos renseignements",
      items: [
        "Pour fournir et maintenir la Plateforme.",
        "Pour traiter les paiements et gérer les comptes.",
        "Pour effectuer les vérifications d’antécédents et valider les certifications.",
        "Pour mettre en relation les parents avec des aides familiales et des garderies.",
        "Pour communiquer avec vous, notamment par l’envoi de notifications et de mises à jour.",
        "Pour améliorer et personnaliser votre expérience.",
        "Pour analyser les données d’utilisation et les tendances.",
        "Pour respecter nos obligations légales.",
        "Pour constituer la liste d’intérêt pour les places en garderie et aviser les utilisateurs des places disponibles.",
        "Pour permettre aux garderies d’annoncer leurs places disponibles.",
      ],
    },
    {
      n: "4",
      title: "Communication de vos renseignements",
      items: [
        "Aides familiales et parents : nous communiquons les renseignements nécessaires entre les parents et les aides familiales pour permettre la prestation du service.",
        "Garderies et parents : nous communiquons les renseignements nécessaires entre les parents et les garderies pour permettre la prestation du service.",
        "Fournisseurs de services tiers : nous pouvons communiquer des renseignements à des fournisseurs tiers qui nous assistent pour le traitement des paiements, les vérifications d’antécédents, l’analyse de données et d’autres services.",
        "Conformité légale : nous pouvons communiquer des renseignements si la loi l’exige ou pour protéger nos droits.",
        "Transferts d’entreprise : en cas de fusion, d’acquisition ou de vente d’actifs, vos renseignements pourraient être transférés.",
      ],
    },
    {
      n: "5",
      title: "Sécurité des données",
      items: [
        "Nous mettons en œuvre des mesures de sécurité raisonnables pour protéger vos renseignements.",
        "Aucune méthode de transmission sur Internet ni de stockage électronique n’est toutefois entièrement sécuritaire.",
      ],
    },
    {
      n: "6",
      title: "Conservation des données",
      lead: "Nous conservons vos renseignements aussi longtemps qu’il est nécessaire pour fournir nos services et respecter nos obligations légales.",
    },
    {
      n: "7",
      title: "Vos droits",
      items: [
        "Vous pouvez consulter, corriger ou supprimer vos renseignements personnels depuis les paramètres de votre compte ou en communiquant avec nous.",
        "Vous pouvez refuser de recevoir des communications promotionnelles.",
        "Vous pouvez demander des renseignements sur l’utilisation qui est faite de vos données.",
        "Les utilisateurs canadiens disposent de droits particuliers en vertu de la LPRPDE et des lois provinciales sur la protection des renseignements personnels.",
      ],
    },
    {
      n: "8",
      title: "Protection de la vie privée des enfants",
      lead: "La Plateforme ne s’adresse pas aux enfants de moins de 13 ans. Nous ne recueillons pas sciemment de renseignements personnels auprès d’enfants de moins de 13 ans.",
    },
    {
      n: "9",
      title: "Modifications de la présente politique de confidentialité",
      lead: "Nous pouvons mettre à jour la présente politique de confidentialité de temps à autre. Nous vous informerons de tout changement en publiant la nouvelle politique de confidentialité sur la Plateforme.",
    },
    {
      n: "10",
      title: "Nous joindre",
      lead: "Si vous avez des questions ou des préoccupations au sujet de la présente politique de confidentialité, écrivez-nous à service@poppynz.com.",
    },
    {
      n: null,
      title: "Points clés de la protection de la vie privée au Canada",
      items: [
        "Conformité à la LPRPDE : nos pratiques respectent la Loi sur la protection des renseignements personnels et les documents électroniques (LPRPDE) ainsi que les lois provinciales applicables.",
        "Consentement : nous obtenons un consentement clair et éclairé pour la collecte, l’utilisation et la communication des renseignements personnels.",
        "Minimisation des données : nous ne recueillons que les renseignements personnels nécessaires aux fins établies.",
        "Sécurité des données : nous mettons en place des mesures de protection appropriées contre l’accès, l’utilisation ou la communication non autorisés des renseignements personnels.",
        "Responsabilité : nous désignons un responsable de la protection de la vie privée chargé de veiller au respect des lois sur la protection des renseignements personnels.",
        "Transferts transfrontaliers : lorsque des renseignements personnels sont transférés à l’extérieur du Canada, nous veillons à ce que des mesures de protection appropriées soient en place.",
      ],
    },
  ],
};

const termsEn: LegalDoc = {
  title: "Terms of Service",
  intro: "The rules for using the Poppynz website and app, for families, Mom Helpers and daycares.",
  note: "Last updated 18 September 2026",
  sections: [
    {
      n: "1",
      title: "Acceptance of Terms",
      items: [
        "By accessing or using the Poppynz website and mobile application (collectively, \"the Platform\"), you agree to be bound by these Terms of Service (\"Terms\"). If you do not agree with any part of these Terms, you must not use the Platform.",
        "Poppynz reserves the right to modify these Terms at any time. Your continued use of the Platform after any changes constitutes acceptance of the new Terms.",
      ],
    },
    {
      n: "2",
      title: "User Accounts",
      items: [
        "Users (Mom Helpers, Parents, Daycares) must create an account to access certain features of the Platform.",
        "You are responsible for maintaining the confidentiality of your account credentials.",
        "You agree to provide accurate and complete information during registration and to update your information as necessary.",
        "Poppynz reserves the right to suspend or terminate accounts that violate these Terms.",
      ],
    },
    {
      n: "3",
      title: "Mom Helper Services",
      items: [
        "Mom Helpers are independent contractors and not employees of Poppynz.",
        "Poppynz is a platform that facilitates connections between parents and Mom Helpers.",
        "Mom Helpers are responsible for obtaining and maintaining any necessary licenses and certifications.",
        "Poppynz conducts background checks and certifications, but does not guarantee the suitability or safety of any Mom Helper.",
        "Mom Helpers are responsible for their own insurance.",
        "Mom Helpers are responsible for paying their own taxes.",
      ],
    },
    {
      n: "4",
      title: "Parent Responsibilities",
      items: [
        "Parents are responsible for verifying the suitability of Mom Helpers.",
        "Parents agree to provide a safe and respectful environment for Mom Helpers.",
        "Parents are responsible for timely payment of services through the Platform.",
        "Parents are responsible for providing accurate information regarding their children.",
      ],
    },
    {
      n: "5",
      title: "Daycare Services",
      items: [
        "Daycares are responsible for the accuracy of their advertising.",
        "Daycares are responsible for their own licensing and insurance.",
        "Daycares are responsible for the care of the children that attend their facility.",
        "Poppynz is not responsible for the care that the daycare provides.",
      ],
    },
    {
      n: "6",
      title: "Payment and Fees",
      items: [
        "Mom Helpers will receive payment through the Platform as described in the Service Agreement.",
        "Poppynz retains a 15% service fee on Mom Helper earnings. Families pay a 5% service fee on top of helper charges.",
        "Payment processing is handled by third-party providers.",
        "All fees are non-refundable, except as expressly stated.",
      ],
    },
    {
      n: "7",
      title: "Daycare Spot Interest List",
      items: [
        "The Daycare Spot Interest List is provided as a convenience and does not guarantee a daycare spot.",
        "Poppynz is not responsible for the availability or quality of daycare services.",
        "Poppynz does not guarantee that a daycare in the area will have available spots.",
      ],
    },
    {
      n: "8",
      title: "Intellectual Property",
      items: [
        "All content on the Platform, including logos, trademarks, and text, is the property of Poppynz.",
        "Users may not reproduce or distribute any content without express permission.",
      ],
    },
    {
      n: "9",
      title: "Limitation of Liability",
      items: [
        "Poppynz is not liable for any damages arising from the use of the Platform or services provided by Mom Helpers or Daycares.",
        "Poppynz is not responsible for any accidents, injuries, or damages that may occur during assistance.",
        "In no event shall Poppynz's liability exceed the fees paid by the user.",
      ],
    },
    {
      n: "10",
      title: "Indemnification",
      lead: "Users agree to indemnify and hold Poppynz harmless from any claims or damages arising from their use of the Platform.",
    },
    {
      n: "11",
      title: "Termination",
      lead: "Poppynz may terminate user accounts for violations of these Terms. Users may terminate their accounts at any time.",
    },
    {
      n: "12",
      title: "Governing Law",
      lead: "These Terms are governed by the laws of Ontario.",
    },
    {
      n: "13",
      title: "Dispute Resolution",
      lead: "Any disputes arising from these Terms will be resolved through the Ontario Court of Justice.",
    },
    {
      n: "14",
      title: "Contact Information",
      lead: "For questions or concerns, please contact us at service@poppynz.com.",
    },
    {
      n: "15",
      title: "Background Checks and Certifications",
      items: [
        "Users agree that Poppynz can perform background checks.",
        "Users agree to provide accurate documentation for certifications.",
      ],
    },
    {
      n: "16",
      title: "Third-Party Links",
      lead: "Poppynz may provide links to third-party sites, and is not responsible for the content of those sites.",
    },
    {
      n: "17",
      title: "Warranties",
      lead: "Poppynz provides the Platform \"as is\" and without any warranties.",
    },
  ],
};

const termsFr: LegalDoc = {
  title: "Conditions d’utilisation",
  intro: "Les règles d’utilisation du site Web et de l’application Poppynz, pour les familles, les aides familiales et les garderies.",
  note: "Dernière mise à jour le 18 septembre 2026",
  sections: [
    {
      n: "1",
      title: "Acceptation des conditions",
      items: [
        "En accédant au site Web et à l’application mobile Poppynz (collectivement, « la Plateforme ») ou en les utilisant, vous acceptez d’être lié par les présentes conditions d’utilisation (les « Conditions »). Si vous n’acceptez pas une partie des présentes Conditions, vous ne devez pas utiliser la Plateforme.",
        "Poppynz se réserve le droit de modifier les présentes Conditions en tout temps. Votre utilisation continue de la Plateforme après une modification vaut acceptation des nouvelles Conditions.",
      ],
    },
    {
      n: "2",
      title: "Comptes d’utilisateur",
      items: [
        "Les utilisateurs (aides familiales, parents, garderies) doivent créer un compte pour accéder à certaines fonctionnalités de la Plateforme.",
        "Vous êtes responsable de la confidentialité de vos identifiants de compte.",
        "Vous acceptez de fournir des renseignements exacts et complets lors de l’inscription et de les tenir à jour.",
        "Poppynz se réserve le droit de suspendre ou de fermer les comptes qui contreviennent aux présentes Conditions.",
      ],
    },
    {
      n: "3",
      title: "Services des aides familiales",
      items: [
        "Les aides familiales sont des entrepreneuses indépendantes et non des employées de Poppynz.",
        "Poppynz est une plateforme qui facilite la mise en relation entre les parents et les aides familiales.",
        "Les aides familiales sont responsables d’obtenir et de maintenir les permis et les certifications nécessaires.",
        "Poppynz effectue des vérifications d’antécédents et de certifications, mais ne garantit ni la compétence ni la sécurité d’une aide familiale.",
        "Les aides familiales sont responsables de leur propre assurance.",
        "Les aides familiales sont responsables du paiement de leurs propres impôts.",
      ],
    },
    {
      n: "4",
      title: "Responsabilités des parents",
      items: [
        "Les parents sont responsables de vérifier que l’aide familiale leur convient.",
        "Les parents s’engagent à offrir un environnement sécuritaire et respectueux aux aides familiales.",
        "Les parents sont responsables du paiement des services dans les délais, par l’intermédiaire de la Plateforme.",
        "Les parents sont responsables de fournir des renseignements exacts au sujet de leurs enfants.",
      ],
    },
    {
      n: "5",
      title: "Services de garderie",
      items: [
        "Les garderies sont responsables de l’exactitude de leurs annonces.",
        "Les garderies sont responsables de leur propre permis et de leur propre assurance.",
        "Les garderies sont responsables des soins donnés aux enfants qui fréquentent leur établissement.",
        "Poppynz n’est pas responsable des soins offerts par la garderie.",
      ],
    },
    {
      n: "6",
      title: "Paiements et frais",
      items: [
        "Les aides familiales sont payées par l’intermédiaire de la Plateforme, comme le décrit l’Entente de service.",
        "Poppynz retient des frais de service de 15 % sur les gains des aides familiales. Les familles paient des frais de service de 5 % en sus des honoraires de l’aide familiale.",
        "Le traitement des paiements est assuré par des fournisseurs tiers.",
        "Tous les frais sont non remboursables, sauf indication expresse contraire.",
      ],
    },
    {
      n: "7",
      title: "Liste d’intérêt pour une place en garderie",
      items: [
        "La liste d’intérêt pour une place en garderie est offerte à titre de commodité et ne garantit aucune place.",
        "Poppynz n’est pas responsable de la disponibilité ni de la qualité des services de garde.",
        "Poppynz ne garantit pas qu’une garderie du secteur aura des places disponibles.",
      ],
    },
    {
      n: "8",
      title: "Propriété intellectuelle",
      items: [
        "Tout le contenu de la Plateforme, y compris les logos, les marques de commerce et les textes, appartient à Poppynz.",
        "Les utilisateurs ne peuvent reproduire ni distribuer ce contenu sans autorisation expresse.",
      ],
    },
    {
      n: "9",
      title: "Limitation de responsabilité",
      items: [
        "Poppynz n’est pas responsable des dommages découlant de l’utilisation de la Plateforme ou des services fournis par les aides familiales ou les garderies.",
        "Poppynz n’est pas responsable des accidents, des blessures ou des dommages pouvant survenir pendant une séance.",
        "La responsabilité de Poppynz ne peut en aucun cas excéder les frais payés par l’utilisateur.",
      ],
    },
    {
      n: "10",
      title: "Indemnisation",
      lead: "Les utilisateurs acceptent d’indemniser Poppynz et de la tenir à couvert de toute réclamation ou de tout dommage découlant de leur utilisation de la Plateforme.",
    },
    {
      n: "11",
      title: "Résiliation",
      lead: "Poppynz peut fermer le compte d’un utilisateur en cas de contravention aux présentes Conditions. Les utilisateurs peuvent fermer leur compte en tout temps.",
    },
    {
      n: "12",
      title: "Droit applicable",
      lead: "Les présentes Conditions sont régies par les lois de l’Ontario.",
    },
    {
      n: "13",
      title: "Règlement des différends",
      lead: "Tout différend découlant des présentes Conditions sera soumis à la Cour de justice de l’Ontario.",
    },
    {
      n: "14",
      title: "Coordonnées",
      lead: "Pour toute question ou préoccupation, écrivez-nous à service@poppynz.com.",
    },
    {
      n: "15",
      title: "Vérifications d’antécédents et certifications",
      items: [
        "Les utilisateurs acceptent que Poppynz puisse effectuer des vérifications d’antécédents.",
        "Les utilisateurs acceptent de fournir des documents exacts à l’appui de leurs certifications.",
      ],
    },
    {
      n: "16",
      title: "Liens vers des sites tiers",
      lead: "Poppynz peut fournir des liens vers des sites tiers et n’est pas responsable du contenu de ces sites.",
    },
    {
      n: "17",
      title: "Garanties",
      lead: "Poppynz fournit la Plateforme « telle quelle », sans aucune garantie.",
    },
  ],
};

const agreementEn: LegalDoc = {
  title: "Service Agreement",
  intro: "This Service Agreement (\"Agreement\") is entered into by and between the caregiver (\"Caregiver\"), the family (\"Family\"), and Poppynz Inc. (\"Platform\"), a technology service provider facilitating connections between Caregivers and Families for childcare and dementia care services.",
  note: "Effective date: 18 September 2026",
  sections: [
    {
      n: "1",
      title: "Scope of Services",
      items: [
        "1.1 The Platform provides an online marketplace to facilitate the hiring of Caregivers for the care of children and adults with dementia.",
        "1.2 The Platform does not employ Caregivers but provides a system for Families to find, book, and review Caregivers.",
        "1.3 The Platform reserves the right to monitor and oversee interactions between Caregivers and Families but is not responsible for the services rendered.",
      ],
    },
    {
      n: "2",
      title: "Responsibilities of Caregivers",
      items: [
        "2.1 Caregivers must complete a background check and verification process before providing services through the Platform.",
        "2.2 Caregivers must act professionally and provide safe, compassionate, and responsible care.",
        "2.3 Caregivers are independent contractors and not employees of the Platform.",
        "2.4 Caregivers are responsible for setting their rates, availability, and terms of service within Platform guidelines.",
      ],
    },
    {
      n: "3",
      title: "Responsibilities of Families",
      items: [
        "3.1 Families must provide accurate and truthful information regarding their care needs.",
        "3.2 Families must compensate Caregivers in accordance with the agreed-upon rates and terms.",
        "3.3 Families must ensure a safe and respectful environment for Caregivers.",
        "3.4 Families agree to report any concerns or misconduct to the Platform immediately.",
      ],
    },
    {
      n: "4",
      title: "Payment and Fees",
      items: [
        "4.1 Payments are processed through the Platform's secure payment system.",
        "4.2 The Platform charges a service fee for facilitating transactions.",
        "4.3 Refunds and cancellations are subject to the Platform's policies and the agreement between the Family and Caregiver.",
      ],
    },
    {
      n: "5",
      title: "Liability and Dispute Resolution",
      items: [
        "5.1 The Platform is not liable for any direct, indirect, or incidental damages resulting from the use of services.",
        "5.2 Disputes between Families and Caregivers should first be attempted to be resolved through mutual discussion.",
        "5.3 If a resolution cannot be reached, the Platform may mediate but is not obligated to provide a final resolution.",
      ],
    },
    {
      n: "6",
      title: "Code of Conduct",
      items: [
        "6.1 All users must treat each other with respect and professionalism.",
        "6.2 Any form of discrimination, harassment, or abuse will result in immediate termination from the Platform.",
        "6.3 The Platform reserves the right to remove users for violations of the Code of Conduct.",
      ],
    },
    {
      n: "7",
      title: "Privacy and Confidentiality",
      items: [
        "7.1 Users agree not to share or misuse personal information obtained through the Platform.",
        "7.2 The Platform collects and stores data in accordance with its Privacy Policy.",
      ],
    },
    {
      n: "8",
      title: "Termination and Amendments",
      items: [
        "8.1 The Platform reserves the right to suspend or terminate accounts for violations of this Agreement.",
        "8.2 The Platform may update this Agreement at any time with notice to users.",
      ],
      tail: "By using the Platform, all parties agree to the terms and conditions outlined above.",
    },
  ],
};

const agreementFr: LegalDoc = {
  title: "Entente de service",
  intro: "La présente entente de service (l’« Entente ») est conclue entre l’aide familiale (l’« Aide familiale »), la famille (la « Famille ») et Poppynz Inc. (la « Plateforme »), un fournisseur de services technologiques qui facilite la mise en relation entre les Aides familiales et les Familles pour des services de garde d’enfants et de soins aux personnes atteintes de démence.",
  note: "Date d’entrée en vigueur : 18 septembre 2026",
  sections: [
    {
      n: "1",
      title: "Portée des services",
      items: [
        "1.1 La Plateforme fournit un marché en ligne qui facilite l’embauche d’Aides familiales pour la garde d’enfants et les soins aux adultes atteints de démence.",
        "1.2 La Plateforme n’emploie pas les Aides familiales; elle fournit un système permettant aux Familles de trouver, de réserver et d’évaluer des Aides familiales.",
        "1.3 La Plateforme se réserve le droit de surveiller les échanges entre les Aides familiales et les Familles, mais n’est pas responsable des services rendus.",
      ],
    },
    {
      n: "2",
      title: "Responsabilités des Aides familiales",
      items: [
        "2.1 Les Aides familiales doivent réussir une vérification d’antécédents et un processus de validation avant d’offrir des services par l’intermédiaire de la Plateforme.",
        "2.2 Les Aides familiales doivent agir avec professionnalisme et offrir des soins sécuritaires, bienveillants et responsables.",
        "2.3 Les Aides familiales sont des entrepreneuses indépendantes et non des employées de la Plateforme.",
        "2.4 Les Aides familiales sont responsables de fixer leurs tarifs, leurs disponibilités et leurs conditions de service dans le respect des règles de la Plateforme.",
      ],
    },
    {
      n: "3",
      title: "Responsabilités des Familles",
      items: [
        "3.1 Les Familles doivent fournir des renseignements exacts et véridiques au sujet de leurs besoins de soins.",
        "3.2 Les Familles doivent rémunérer les Aides familiales selon les tarifs et les conditions convenus.",
        "3.3 Les Familles doivent assurer un environnement sécuritaire et respectueux aux Aides familiales.",
        "3.4 Les Familles s’engagent à signaler sans délai à la Plateforme toute préoccupation ou tout comportement inapproprié.",
      ],
    },
    {
      n: "4",
      title: "Paiements et frais",
      items: [
        "4.1 Les paiements sont traités par le système de paiement sécurisé de la Plateforme.",
        "4.2 La Plateforme facture des frais de service pour la facilitation des transactions.",
        "4.3 Les remboursements et les annulations sont assujettis aux politiques de la Plateforme et à l’entente conclue entre la Famille et l’Aide familiale.",
      ],
    },
    {
      n: "5",
      title: "Responsabilité et règlement des différends",
      items: [
        "5.1 La Plateforme n’est responsable d’aucun dommage direct, indirect ou accessoire découlant de l’utilisation des services.",
        "5.2 Les différends entre les Familles et les Aides familiales doivent d’abord faire l’objet d’une tentative de règlement à l’amiable.",
        "5.3 Si aucun règlement n’est possible, la Plateforme peut agir comme médiatrice, sans être tenue de rendre une décision finale.",
      ],
    },
    {
      n: "6",
      title: "Code de conduite",
      items: [
        "6.1 Tous les utilisateurs doivent se traiter avec respect et professionnalisme.",
        "6.2 Toute forme de discrimination, de harcèlement ou d’abus entraîne l’exclusion immédiate de la Plateforme.",
        "6.3 La Plateforme se réserve le droit de retirer un utilisateur qui contrevient au code de conduite.",
      ],
    },
    {
      n: "7",
      title: "Vie privée et confidentialité",
      items: [
        "7.1 Les utilisateurs s’engagent à ne pas communiquer ni utiliser à mauvais escient les renseignements personnels obtenus par l’intermédiaire de la Plateforme.",
        "7.2 La Plateforme recueille et conserve les données conformément à sa politique de confidentialité.",
      ],
    },
    {
      n: "8",
      title: "Résiliation et modifications",
      items: [
        "8.1 La Plateforme se réserve le droit de suspendre ou de fermer un compte en cas de contravention à la présente Entente.",
        "8.2 La Plateforme peut modifier la présente Entente en tout temps, moyennant un avis aux utilisateurs.",
      ],
      tail: "En utilisant la Plateforme, toutes les parties acceptent les conditions énoncées ci-dessus.",
    },
  ],
};

export const LEGAL_COMMON: Localized<LegalCommon> = {
  en: {
    eyebrow: "Poppynz Inc.",
    tocLabel: "On this page",
    contact: "Questions about this document? We\u2019re happy to help.",
    contactEmail: "service@poppynz.com",
  },
  fr: {
    eyebrow: "Poppynz Inc.",
    tocLabel: "Sur cette page",
    contact: "Des questions sur ce document? Nous sommes là pour vous aider.",
    contactEmail: "service@poppynz.com",
  },
};

export const LEGAL: Record<LegalDocKey, Localized<LegalDoc>> = {
  privacy: { en: privacyEn, fr: privacyFr },
  terms: { en: termsEn, fr: termsFr },
  agreement: { en: agreementEn, fr: agreementFr },
};
