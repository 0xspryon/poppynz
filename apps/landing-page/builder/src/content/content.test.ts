import { describe, expect, test } from "bun:test";
import { DAYCARE } from "./daycare";
import { FAMILIES } from "./families";
import { FOOTER } from "./footer";
import { HEADER } from "./header";
import { HELPERS } from "./helpers";
import { HOME } from "./home";
import { LEGAL, LEGAL_COMMON, LEGAL_DOCS } from "./legal";
import { SAFETY } from "./safety";
import { assertLocalizedKeys } from "./types";

describe("content", () => {
  test("header, footer, home, families, helpers, safety, daycare have identical key sets in en and fr", () => {
    expect(() => assertLocalizedKeys(HEADER as any, "header")).not.toThrow();
    expect(() => assertLocalizedKeys(FOOTER as any, "footer")).not.toThrow();
    expect(() => assertLocalizedKeys(HOME as any, "home")).not.toThrow();
    expect(() => assertLocalizedKeys(FAMILIES as any, "families")).not.toThrow();
    expect(() => assertLocalizedKeys(HELPERS as any, "helpers")).not.toThrow();
    expect(() => assertLocalizedKeys(SAFETY as any, "safety")).not.toThrow();
    expect(() => assertLocalizedKeys(DAYCARE as any, "daycare")).not.toThrow();
    expect(() => assertLocalizedKeys(LEGAL_COMMON as any, "legal common")).not.toThrow();
    for (const doc of LEGAL_DOCS) expect(() => assertLocalizedKeys(LEGAL[doc] as any, `legal ${doc}`)).not.toThrow();
  });
  test("the three legal documents have the design's section counts and numbering in both languages", () => {
    const counts = { privacy: 11, terms: 17, agreement: 8 } as const;
    for (const l of ["en", "fr"] as const) {
      for (const doc of LEGAL_DOCS) {
        const d = LEGAL[doc][l];
        expect(d.sections).toHaveLength(counts[doc]);
        // The design numbers every section 1..n except the Privacy Policy's closing
        // "Key Considerations for Canadian Privacy", which it leaves unnumbered.
        const numbered = d.sections.filter((s) => s.n !== null);
        expect(numbered.map((s) => s.n)).toEqual(numbered.map((_, i) => String(i + 1)));
        expect(d.sections.filter((s) => s.n === null)).toHaveLength(doc === "privacy" ? 1 : 0);
        // Every section carries at least one of the four body slots.
        for (const s of d.sections) expect(Boolean(s.lead || s.items || s.subs || s.tail)).toBe(true);
      }
      expect(LEGAL.privacy[l].sections[1].subs).toHaveLength(2);
      expect(LEGAL.agreement[l].sections[7].tail).toBeTruthy();
    }
  });
  test("home has 4 steps, 8 services, 3 quotes, 5 cities in both languages", () => {
    for (const l of ["en", "fr"] as const) {
      expect(HOME[l].steps).toHaveLength(4);
      expect(HOME[l].services).toHaveLength(8);
      expect(HOME[l].quotes).toHaveLength(3);
      expect(HOME[l].cities).toHaveLength(5);
    }
  });
  test("families has 4 benefit cards, 6 checks, 4 safety steps, 6 FAQ items in both languages", () => {
    for (const l of ["en", "fr"] as const) {
      expect(FAMILIES[l].benefits.cards).toHaveLength(4);
      expect(FAMILIES[l].profile.checks).toHaveLength(6);
      expect(FAMILIES[l].profile.card.services).toHaveLength(3);
      expect(FAMILIES[l].profile.card.chips).toHaveLength(3);
      expect(FAMILIES[l].safety.steps).toHaveLength(4);
      expect(FAMILIES[l].fee.example.rows).toHaveLength(2);
      expect(FAMILIES[l].faq.items).toHaveLength(6);
    }
  });
  test("helpers has 4 why-join cards, 3 service rows, 4 onboarding steps, 3+3 documents, 4 Major-domo rows, 6 FAQ items in both languages", () => {
    for (const l of ["en", "fr"] as const) {
      expect(HELPERS[l].why.cards).toHaveLength(4);
      expect(HELPERS[l].rates.panel.rows).toHaveLength(3);
      expect(HELPERS[l].onboarding.steps).toHaveLength(4);
      expect(HELPERS[l].onboarding.required.items).toHaveLength(3);
      expect(HELPERS[l].onboarding.optional.items).toHaveLength(3);
      expect(HELPERS[l].earnings.example.rows).toHaveLength(2);
      expect(HELPERS[l].major.rows).toHaveLength(4);
      expect(HELPERS[l].faq.items).toHaveLength(6);
    }
  });
  test("safety has 5 hero pills, 5 status rows, 6 check cards, 4 Credibled points, 4 review steps, 4 family checks, 4 privacy cards, 6 promises in both languages", () => {
    for (const l of ["en", "fr"] as const) {
      expect(SAFETY[l].hero.nav).toHaveLength(5);
      expect(SAFETY[l].hero.card.rows).toHaveLength(5);
      expect(SAFETY[l].checks.cards).toHaveLength(6);
      expect(SAFETY[l].credibled.points).toHaveLength(4);
      expect(SAFETY[l].review.steps).toHaveLength(4);
      expect(SAFETY[l].families.checks).toHaveLength(4);
      expect(SAFETY[l].data.cards).toHaveLength(4);
      expect(SAFETY[l].never.items).toHaveLength(6);
    }
  });
  test("daycare has 4 family steps, 3 notification rows, 4 listing rows in both languages", () => {
    for (const l of ["en", "fr"] as const) {
      expect(DAYCARE[l].families.steps).toHaveLength(4);
      expect(DAYCARE[l].notify.card.rows).toHaveLength(3);
      expect(DAYCARE[l].daycares.rows).toHaveLength(4);
    }
  });
  test("nav links use page keys", () => {
    for (const item of HEADER.en.nav) expect(item.page).toMatch(/^(families|helpers|safety|daycare|blog)$/);
  });
});
