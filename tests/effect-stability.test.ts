import { expect, it } from "vitest";

// ADR 0006: Effect's stable core only. In effect 4.0.x every subpath module
// except the test clock, the root export `Arbitrary`, and some exports of
// `Schema` are tagged `@stability unstable` and may change in a patch release.

const sources: Record<string, string> = import.meta.glob(
  ["../app/**/*.{ts,tsx}", "../workers/**/*.ts", "./**/*.ts"],
  { query: "?raw", import: "default", eager: true },
);

const schemaTypes: string = (
  await import("../node_modules/effect/dist/Schema.d.ts?raw")
).default;

const ALLOWED_MODULES = new Set(["effect", "effect/testing/TestClock"]);

/** Names declared in Schema.d.ts directly after a `@stability unstable` tag. */
function unstableSchemaExports(): Set<string> {
  const names = new Set<string>();
  const tagged = /@stability unstable[\s\S]*?\*\/\s*export (?:declare )?(?:const|function|interface|type|class) (\w+)/g;
  for (const match of schemaTypes.matchAll(tagged)) names.add(match[1]!);
  return names;
}

it("imports Effect only from its stable modules", () => {
  expect(Object.keys(sources).length).toBeGreaterThan(10);

  const offences: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    for (const match of text.matchAll(/from\s+"(effect(?:\/[^"]*)?)"/g)) {
      if (!ALLOWED_MODULES.has(match[1]!)) offences.push(`${file}: ${match[1]}`);
    }
    for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"effect"/g)) {
      if (/\bArbitrary\b/.test(match[1]!)) offences.push(`${file}: Arbitrary`);
    }
  }
  expect(offences).toEqual([]);
});

it("uses no Schema export tagged unstable", () => {
  const unstable = unstableSchemaExports();
  // Known members, so that a change in how the tag is written fails loudly.
  expect(unstable).toContain("Cookies");
  expect(unstable).toContain("UrlParams");
  expect(unstable).not.toContain("Struct");

  const offences: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    for (const match of text.matchAll(/\bSchema\.(\w+)/g)) {
      if (unstable.has(match[1]!)) offences.push(`${file}: Schema.${match[1]}`);
    }
  }
  expect(offences).toEqual([]);
});
