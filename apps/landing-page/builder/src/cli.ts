import { resolve } from "node:path";
import { lintClasses } from "./classes";
import { buildArtefact } from "./emit/artefact";
import { daycareRecipe } from "./recipes/daycare";
import { familiesRecipe } from "./recipes/families";
import { footerRecipe } from "./recipes/footer";
import { headerRecipe } from "./recipes/header";
import { helpersRecipe } from "./recipes/helpers";
import { homeRecipe } from "./recipes/home";
import { legalRecipe } from "./recipes/legal";
import { safetyRecipe } from "./recipes/safety";

// The three legal documents share one recipe; see recipes/legal.ts.
export const RECIPES = [headerRecipe, footerRecipe, homeRecipe, familiesRecipe, helpersRecipe, safetyRecipe, daycareRecipe,
  legalRecipe("privacy"), legalRecipe("terms"), legalRecipe("agreement")];

export async function runCli(argv: string[], outDirOverride?: string): Promise<number> {
  const [cmd, name = "current"] = argv;
  if (cmd !== "build" && cmd !== "check") {
    console.error(`usage: bun run src/cli.ts build|check [build-name] (got "${cmd ?? ""}")`);
    return 2;
  }
  const problems = lintClasses();
  if (problems.length) { console.error(problems.join("\n")); return 1; }
  const base = outDirOverride ?? process.env.POPPYNZ_OUT_DIR ?? resolve(import.meta.dir, "../../json-artefacts");
  const outDir = resolve(base, name);
  if (cmd === "check") {
    const { mkdtempSync, rmSync } = await import("node:fs"); const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(resolve(tmpdir(), "poppynz-check-"));
    await buildArtefact({ outDir: dir, recipes: RECIPES });
    rmSync(dir, { recursive: true, force: true });
    console.log("check: ok");
    return 0;
  }
  const m = await buildArtefact({ outDir, recipes: RECIPES });
  console.log(`build: ${m.entries.length} entries, ${Object.keys(m.media).length} media files -> ${outDir}`);
  return 0;
}

if (import.meta.main) {
  process.exit(await runCli(process.argv.slice(2)));
}
