import { describe, expect, test } from "bun:test";
import { FAMILIES } from "./families";
import { FOOTER } from "./footer";
import { HEADER } from "./header";
import { HOME } from "./home";
import { assertLocalizedKeys } from "./types";

describe("content", () => {
  test("header, footer, home, families have identical key sets in en and fr", () => {
    expect(() => assertLocalizedKeys(HEADER as any, "header")).not.toThrow();
    expect(() => assertLocalizedKeys(FOOTER as any, "footer")).not.toThrow();
    expect(() => assertLocalizedKeys(HOME as any, "home")).not.toThrow();
    expect(() => assertLocalizedKeys(FAMILIES as any, "families")).not.toThrow();
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
  test("nav links use page keys", () => {
    for (const item of HEADER.en.nav) expect(item.page).toMatch(/^(families|helpers|safety|daycare|blog)$/);
  });
});
