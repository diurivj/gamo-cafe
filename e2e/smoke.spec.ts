import { expect, test } from "./fixtures";
import { leaveOpen } from "./support/sell";

test("a signed-out visitor loads the Spanish shell on a phone", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");

  // Nobody is signed in, so the app shows Entrar.
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es-MX");
  await expect(page).toHaveTitle("Entrar · Gamo Cafe");

  // Installable: the manifest and its icons are served; no service worker.
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await request.get(manifestHref!);
  expect(manifest.ok()).toBe(true);
  const { icons } = (await manifest.json()) as { icons: Array<{ src: string }> };
  for (const icon of icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  expect(await page.evaluate(() => navigator.serviceWorker?.getRegistrations().then((all) => all.length) ?? 0)).toBe(0);

  // Phone-first: nothing scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // The Worker reaches its migrated D1 through the Db service.
  const health = await request.get("/healthz");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true });

  expect(errors).toEqual([]);
});

// Spec §3.4: designed for a phone, and usable on a laptop. This is the
// desktop-width pass over the Admin screens, with the same no-sideways rule.
test("an Admin's screens work on a laptop width too, with nothing scrolling sideways", async ({
  page,
  signInAs,
  addItem,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAs("admin", "Ana");
  await addItem({ name: "Producto de laptop", price: 1500 });

  // A sale in a few taps, at the desk.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vender" })).toBeVisible();
  await leaveOpen(page, { items: ["Producto de laptop"] });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  for (const path of ["/cuentas", "/inventario", "/historial", "/usuarios", "/productos", "/por-cobrar"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
});
