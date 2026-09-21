import { describe, expect, test } from "bun:test";
import { runCli } from "./cli";

describe("cli", () => {
  test("unknown command exits 2", async () => {
    expect(await runCli(["nope"])).toBe(2);
  });
  test("check with no recipes exits 0", async () => {
    expect(await runCli(["check"])).toBe(0);
  });
});
