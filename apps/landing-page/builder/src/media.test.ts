import { describe, expect, test } from "bun:test";
import { svg } from "./dsl";
import { MediaRegistry, resolveMedia } from "./media";

describe("media", () => {
  test("registers a design asset with a content hash", () => {
    const reg = new MediaRegistry();
    const f = reg.add("logo-mark", "../../design/assets/logo-mark.svg", "Poppynz");
    expect(f.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(f.ext).toBe("svg");
    expect(reg.get("logo-mark")).toBe(f);
  });
  test("icons come from line-awesome solid set", () => {
    const reg = new MediaRegistry();
    const f = reg.icon("check");
    expect(f.key).toBe("icon:check");
    expect(f.sourcePath).toMatch(/line-awesome\/svg\/check-solid\.svg$/);
    expect(() => reg.icon("not-an-icon-xyz")).toThrow(/not-an-icon-xyz/);
  });
  test("resolveMedia swaps keys for hashes", () => {
    const reg = new MediaRegistry(); reg.icon("check");
    const el = resolveMedia(svg("s", { title: "s", icon: "icon:check" }), reg);
    expect((el.settings.svg as any).value.id.value).toBe(reg.get("icon:check").hash);
    expect(() => resolveMedia(svg("t", { title: "t", icon: "icon:missing" }), reg)).toThrow(/icon:missing/);
  });
  test("resolveMedia is idempotent", () => {
    const reg = new MediaRegistry(); reg.icon("check");
    const el = svg("s", { title: "s", icon: "icon:check" });
    const resolved1 = resolveMedia(el, reg);
    const resolved2 = resolveMedia(resolved1, reg);
    expect((resolved2.settings.svg as any).value.id.value).toBe((resolved1.settings.svg as any).value.id.value);
  });
  test("rejects values that are 12 hex chars but neither keys nor registered hashes", () => {
    const reg = new MediaRegistry(); reg.icon("check");
    const fakeHash = "abcdef123456"; // 12 hex chars but not a registered hash or key
    const el = svg("s", { title: "s", icon: fakeHash });
    expect(() => resolveMedia(el, reg)).toThrow(/not registered/);
  });
});
