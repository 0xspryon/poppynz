import { describe, expect, test } from "bun:test";
import { runCli } from "./cli";

describe("cli", () => {
  test("unknown command exits 2", async () => {
    expect(await runCli(["nope"])).toBe(2);
  });
  test("check with no recipes exits 0", async () => {
    expect(await runCli(["check"])).toBe(0);
  });
  test("build writes json-artefacts/<name>", async () => {
    const { existsSync, rmSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const dir = resolve(import.meta.dir, "../../json-artefacts/test-build");
    expect(await runCli(["build", "test-build"])).toBe(0);
    expect(existsSync(resolve(dir, "pages/home.en.json"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
