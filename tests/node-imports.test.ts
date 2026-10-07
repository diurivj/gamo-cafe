import { describe, expect, it } from "vitest";

// The command-line scripts run under plain Node (`node scripts/sign-in-code.ts`),
// which resolves every relative import by its real file: no `~`, and the
// extension has to be there. Vitest resolves both, so nothing else can hold
// this contract (ticket 35).

/** The plain modules `tsconfig.node.json` lists, and the scripts that are run. */
const PLAIN = [
  "../app/backend/command-line.ts",
  "../app/backend/rebuild.ts",
  "../app/backend/seed.ts",
  "../app/shared/day.ts",
  "../app/shared/normalize-name.ts",
  "../app/shared/secret.ts",
  "../app/shared/sha256.ts",
  "../scripts/projections.ts",
  "../scripts/seed.ts",
  "../scripts/sign-in-code.ts",
];

const sources: Record<string, string> = import.meta.glob(
  [
    "../app/backend/command-line.ts",
    "../app/backend/rebuild.ts",
    "../app/backend/seed.ts",
    "../app/shared/day.ts",
    "../app/shared/normalize-name.ts",
    "../app/shared/secret.ts",
    "../app/shared/sha256.ts",
    "../scripts/*.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** Every import specifier of one file, multi-line imports included. */
function importsOf(text: string): Array<string> {
  return [...text.matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((match) => match[1]!);
}

describe("a module Node runs as it is", () => {
  it("imports only relative paths, with their .ts extension", () => {
    expect(Object.keys(sources).sort()).toEqual([...PLAIN].sort());

    const offences: Array<string> = [];
    for (const [path, text] of Object.entries(sources)) {
      for (const specifier of importsOf(text)) {
        if (specifier.startsWith("~")) offences.push(`${path}: ${specifier}`);
        else if (specifier.startsWith(".") && !specifier.endsWith(".ts")) offences.push(`${path}: ${specifier}`);
      }
    }
    expect(offences).toEqual([]);
  });
});
