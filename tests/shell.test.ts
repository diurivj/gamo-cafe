import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("serves a Spanish page to a signed-out visitor", async () => {
  const response = await exports.default.fetch("https://gamo.test/");

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("text/html");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const html = await response.text();
  expect(html).toContain('<html lang="es-MX">');
  expect(html).toContain("Gamo Cafe");
  expect(html).toContain('rel="manifest"');
});
