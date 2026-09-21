export type Command = "build" | "check";

export async function runCli(argv: string[]): Promise<number> {
  const [cmd] = argv;
  if (cmd !== "build" && cmd !== "check") {
    console.error(`usage: bun run src/cli.ts build|check (got "${cmd ?? ""}")`);
    return 2;
  }
  // Later tasks register recipes here; with none registered both commands succeed.
  console.log(`${cmd}: nothing to do yet`);
  return 0;
}

if (import.meta.main) {
  process.exit(await runCli(process.argv.slice(2)));
}
