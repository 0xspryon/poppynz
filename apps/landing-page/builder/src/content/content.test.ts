import { describe, expect, test } from "bun:test";
import { FOOTER } from "./footer";
import { HEADER } from "./header";
import { HOME } from "./home";
import { assertLocalizedKeys } from "./types";

describe("content", () => {
  test("header, footer, home have identical key sets in en and fr", () => {
    expect(() => assertLocalizedKeys(HEADER as any, "header")).not.toThrow();
    expect(() => assertLocalizedKeys(FOOTER as any, "footer")).not.toThrow();
    expect(() => assertLocalizedKeys(HOME as any, "home")).not.toThrow();
  });
  test("home has 4 steps, 8 services, 3 quotes, 5 cities in both languages", () => {
    for (const l of ["en", "fr"] as const) {
      expect(HOME[l].steps).toHaveLength(4);
      expect(HOME[l].services).toHaveLength(8);
      expect(HOME[l].quotes).toHaveLength(3);
      expect(HOME[l].cities).toHaveLength(5);
    }
  });
  test("nav links use page keys", () => {
    for (const item of HEADER.en.nav) expect(item.page).toMatch(/^(families|helpers|safety|daycare|blog)$/);
  });
});
