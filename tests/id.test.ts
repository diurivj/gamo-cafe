import { expect, it } from "vitest";

import { newId } from "~/shared/id";

it("makes identifiers that never repeat and are safe in a URL path", () => {
  const ids = Array.from({ length: 1000 }, () => newId());

  expect(new Set(ids).size).toBe(1000);
  for (const id of ids) expect(id).toMatch(/^[0-9a-z-]{36}$/);
});
