import { describe, expect, test } from "bun:test";
import { elementId, globalClassId, hex7, localStyleId } from "./ids";

describe("ids", () => {
  test("hex7 is 7 lowercase hex and deterministic", () => {
    expect(hex7("home/hero")).toMatch(/^[0-9a-f]{7}$/);
    expect(hex7("home/hero")).toBe(hex7("home/hero"));
    expect(hex7("home/hero")).not.toBe(hex7("home/hero2"));
  });
  test("element and style ids", () => {
    const id = elementId("home/hero/h1");
    expect(localStyleId(id)).toMatch(new RegExp(`^e-${id}-[0-9a-f]{7}$`));
    expect(globalClassId("btn-primary")).toMatch(/^g-[0-9a-f]{7}$/);
  });
});
