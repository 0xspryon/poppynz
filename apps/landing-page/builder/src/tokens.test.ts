import { describe, expect, test } from "bun:test";
import { VARIABLES, v } from "./tokens";

describe("tokens", () => {
  test("labels are unique, no spaces, <= 50 chars", () => {
    const labels = VARIABLES.map((x) => x.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l).toMatch(/^[a-z][a-z0-9-]{0,49}$/);
  });
  test("v() references declared labels only", () => {
    expect(v("navy")).toBe("var(--navy)");
    expect(() => v("nope")).toThrow(/nope/);
  });
  test("core palette present", () => {
    const byLabel = Object.fromEntries(VARIABLES.map((x) => [x.label, x.value]));
    expect(byLabel.navy).toBe("#1A3375");
    expect(byLabel.sky).toBe("#37B5FF");
    expect(byLabel["font-display"]).toBe("Hanken Grotesk");
  });
});
