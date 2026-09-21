import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCli } from "./cli";

describe("cli", () => {
  test("unknown command exits 2", async () => {
    expect(await runCli(["nope"])).toBe(2);
  });
  test("check exits 0", async () => {
    expect(await runCli(["check"])).toBe(0);
  });
  test("build writes json-artefacts/<name>", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "poppynz-cli-"));
    try {
      expect(await runCli(["build", "test-build"], outDir)).toBe(0);
      expect(existsSync(resolve(outDir, "test-build/pages/home.en.json"))).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
