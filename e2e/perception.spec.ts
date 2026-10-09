import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { tapAndSeeNextFrame } from "./support/frame";
import { holdSubmissions } from "./support/held";
import { destinations } from "./support/navigate";
import { itemButton, review, select, selection, totalBar } from "./support/sell";

// UI redesign §8, §9 and §10.2: what the scan of e2e/accessibility.spec.ts
// cannot judge and a browser still can measure. The edge of a control and the
// mark of the focus against what is behind them (WCAG 1.4.11, 2.4.7), motion a
// User asked not to have, a page that can be zoomed, the keyboard a field
// asks a phone for, and whether a tap is answered by the next frame on a
// processor made six times slower.

/** How far apart two colors are, as WCAG counts it: 1 to 21. */
const contrast = (one: readonly number[], other: readonly number[]) => {
  const luminance = (rgb: readonly number[]) => {
    const [r, g, b] = rgb.map((part) => {
      const share = part / 255;
      return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

/** A computed color of the element as the screen paints it: red, green, blue. */
const colorOf = (control: Locator, property: "borderTopColor" | "backgroundColor" | "color" | "outlineColor") =>
  control.evaluate((element, name) => {
    // Painted and read back, so that `oklch(...)` comes out as what a screen shows.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const paint = canvas.getContext("2d", { willReadFrequently: true })!;
    paint.fillStyle = "#fff";
    paint.fillRect(0, 0, 1, 1);
    paint.fillStyle = getComputedStyle(element)[name];
    paint.fillRect(0, 0, 1, 1);
    return [...paint.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, property);

const WHITE = [255, 255, 255];

test("the edge of every kind of control, and the mark of the focus, stand out from the page at 3:1", async ({
  page,
  signInAs,
  addItem,
  browserName,
}) => {
  // Safari stops at links with Option+Tab unless its setting says otherwise.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  const ana = await signInAs("admin", "Ana");
  await addItem({ name: "Agua mineral", price: 1850, stock: { units: 5, by: ana } });

  // A text field, a choice of two, a button with only an edge.
  await page.goto("/");
  await select(page, ["Agua mineral"]);
  await review(page);
  const edged: Array<[string, Locator]> = [
    ["a field", page.getByLabel("Nota (opcional)")],
    ["a radio's circle", page.getByRole("radio", { name: "Transferencia" })],
    ["the card of a choice that is not on", page.locator("label", { hasText: "Transferencia" })],
    ["an outline button", page.getByRole("button", { name: "Dejar abierta" })],
  ];
  for (const [name, control] of edged) {
    expect(contrast(await colorOf(control, "borderTopColor"), WHITE), name).toBeGreaterThanOrEqual(3);
  }
  // The choice that is on is told by a heavier, darker edge and by its weight, not by color alone.
  const on = page.locator("label", { hasText: "Efectivo" }).first();
  expect(contrast(await colorOf(on, "borderTopColor"), WHITE)).toBeGreaterThanOrEqual(7);
  expect(await on.evaluate((label) => Number(getComputedStyle(label).fontWeight))).toBeGreaterThanOrEqual(600);
  // The dark button's fill is its edge.
  const primary = page.getByRole("button", { name: /^Registrar pago de / });
  expect(contrast(await colorOf(primary, "backgroundColor"), WHITE)).toBeGreaterThanOrEqual(3);
  expect(contrast(await colorOf(primary, "color"), await colorOf(primary, "backgroundColor"))).toBeGreaterThanOrEqual(4.5);

  await page.goto("/inventario?paso=ajustar");
  for (const [name, control] of [
    ["a select", page.getByLabel("Producto", { exact: true })],
    ["a number field", page.getByLabel("Unidades", { exact: true })],
  ] as const) {
    expect(contrast(await colorOf(control, "borderTopColor"), WHITE), name).toBeGreaterThanOrEqual(3);
  }

  // The focus, reached with the keyboard: a field's edge darkens and a ring is
  // drawn around it; a plain link gets the page's own outline.
  const units = page.getByLabel("Unidades", { exact: true });
  const resting = await colorOf(units, "borderTopColor");
  await units.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(units).toBeFocused();
  // A field's edge takes 150ms to darken.
  await expect.poll(async () => contrast(await colorOf(units, "borderTopColor"), WHITE)).toBeGreaterThanOrEqual(7);
  expect(contrast(await colorOf(units, "borderTopColor"), resting)).toBeGreaterThan(1.5);
  expect(await units.evaluate((field) => getComputedStyle(field).boxShadow)).not.toBe("none");

  await page.goto("/mas");
  await page.keyboard.press(tab);
  const skip = page.getByRole("link", { name: "Ir al contenido" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press(tab);
  const first = destinations(page).getByRole("link", { name: "Inicio", exact: true });
  await expect(first).toBeFocused();
  expect(await first.evaluate((link) => getComputedStyle(link).outlineStyle)).not.toBe("none");
  expect(await first.evaluate((link) => Number.parseFloat(getComputedStyle(link).outlineWidth))).toBeGreaterThanOrEqual(2);
  expect(contrast(await colorOf(first, "outlineColor"), WHITE)).toBeGreaterThanOrEqual(3);
});

test("a User who asked for less motion gets none that lasts, and nothing waits for an animation", async ({
  page,
  signInAs,
  addItem,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInAs("worker", "Beto");
  await addItem({ name: "Agua mineral", price: 1850 });
  await page.goto("/");
  await select(page, ["Agua mineral"]);

  // A dialog opens, and is there at once.
  await page.getByRole("button", { name: "Vaciar" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  /** The longest any animation or transition on the page runs, in milliseconds. */
  const longest = () =>
    page.evaluate(() => {
      const milliseconds = (text: string) => Math.max(...text.split(",").map((part) => Number.parseFloat(part) * (part.includes("ms") ? 1 : 1000)));
      const styled = [...document.querySelectorAll("*")].map((element) => {
        const style = getComputedStyle(element);
        return Math.max(milliseconds(style.transitionDuration), milliseconds(style.animationDuration));
      });
      const running = document.getAnimations().map((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0));
      return Math.max(0, ...styled, ...running);
    });
  expect(await longest()).toBeLessThanOrEqual(1);
  await dialog.getByRole("button", { name: "Conservar" }).click();
  await expect(dialog).toHaveCount(0);

  // The step changes and the result arrives without anything to wait for.
  await review(page);
  expect(await longest()).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: /^Registrar pago de / }).click();
  await expect(page.getByRole("heading", { name: "Pago registrado", level: 1 })).toBeVisible();
  expect(await longest()).toBeLessThanOrEqual(1);
});

test("the page can be zoomed, and each field asks a phone for the keyboard its value needs", async ({
  page,
  signInAs,
  addItem,
}) => {
  await page.goto("/entrar");
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).not.toMatch(/user-scalable|maximum-scale|minimum-scale/);
  // A code is letters and digits, typed or pasted: the phone may offer one it was sent.
  const code = page.getByLabel("Código de acceso");
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  expect(await code.getAttribute("inputmode")).toBeNull();
  expect(await code.getAttribute("maxlength")).toBeNull();

  const ana = await signInAs("admin", "Ana");
  await addItem({ name: "Agua mineral", price: 1850, stock: { units: 5, by: ana } });
  await page.goto("/");
  await select(page, ["Agua mineral"]);
  await review(page);
  await page.getByRole("button", { name: "Cobrar solo una parte" }).click();
  // Money takes a decimal point; units do not. Neither is a `type="number"`
  // field, which would refuse a pasted "$18.50" and spin under a finger.
  for (const money of [page.getByLabel("Monto a cobrar"), page.getByLabel("Efectivo que te entregan (opcional)")]) {
    await expect(money).toHaveAttribute("inputmode", "decimal");
    expect(await money.getAttribute("type")).not.toBe("number");
  }
  await page.goto("/inventario?paso=ajustar");
  await expect(page.getByLabel("Unidades", { exact: true })).toHaveAttribute("inputmode", "numeric");
  await page.goto("/inventario/conteo");
  await expect(page.getByLabel("Agua mineral", { exact: true })).toHaveAttribute("inputmode", "numeric");
  await page.goto("/productos?paso=nuevo");
  await expect(page.getByLabel("Precio", { exact: true })).toHaveAttribute("inputmode", "decimal");
});

test("on a processor six times slower, a unit added and a Payment sent are answered by the next frame", async ({
  page,
  signInAs,
  addItem,
  query,
}, testInfo) => {
  // The throttle is Chromium's; the same taps are asserted unthrottled, on
  // both engines, by each screen's own spec.
  test.skip(testInfo.project.name !== "android", "CPU throttling needs Chromium's DevTools protocol");
  await signInAs("worker", "Beto");
  for (let n = 1; n <= 40; n++) await addItem({ name: `Producto ${n}`, price: 1000 + n });
  await page.goto("/inicio");
  const devtools = await page.context().newCDPSession(page);
  await devtools.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  const took: Record<string, number> = {};
  const tap = async (what: string, control: Locator, shows: string) => {
    const { seen, after } = await tapAndSeeNextFrame(control, shows);
    expect(seen, what).toBe(true);
    took[what] = after;
  };

  // A destination is not a form: the router marks it and says it is loading
  // when it gets to it, which e2e/navigation.spec.ts holds. Here it is timed.
  const tapped = Date.now();
  await destinations(page).getByRole("link", { name: "Vender", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeVisible();
  took["a destination, to its screen"] = Date.now() - tapped;

  // A unit is added with no request at all.
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await tap("an Item", itemButton(page, "Producto 7"), "1 producto");
  await tap("another unit", page.getByRole("button", { name: "Agregar uno de Producto 7" }), "2 productos");
  // The review is another address of the same screen: timed like a
  // destination, and it asks the server for nothing.
  const forward = Date.now();
  await totalBar(page).getByRole("button", { name: "Cobrar" }).click();
  await expect(selection(page)).toContainText("2 × Producto 7");
  took["the review, to its step"] = Date.now() - forward;
  expect(requests).toEqual([]);

  // The Payment says it is on its way while the server has not answered.
  const held = await holdSubmissions(page);
  await tap("the Payment", page.getByRole("button", { name: /^Registrar pago de / }), "Registrando pago");
  await held.waitFor(1);
  expect(await query("SELECT id FROM bills")).toHaveLength(0);
  await held.releaseAll();
  await held.stop();
  await expect(page.getByRole("heading", { name: "Pago registrado", level: 1 })).toBeVisible();

  await devtools.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  // Written down for .scratch/ui-redesign/verification.md (the HTML report has the attachment), not asserted.
  await testInfo.attach("milliseconds from tap to next frame, CPU 6x slower", { body: JSON.stringify(took, null, 2), contentType: "application/json" });
});
