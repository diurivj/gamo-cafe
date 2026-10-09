import { expect, test } from "./fixtures";
import { review, select } from "./support/sell";

// UI redesign §8 and §10.2: what a screen reader is given to read, in the
// order it is given, on the five walks the spec names: signing in, the
// navigation, a sale with its Payment, a report, and a Stock task. Each
// snapshot is the browser's own accessibility tree: the roles, the names and
// their order, which is what a reader's cursor moves through.
//
// It is not a screen reader. How VoiceOver or TalkBack pronounce these names,
// what they say when a step changes, and whether that is enough to work by,
// is for a person to hear: `.scratch/ui-redesign/verification.md` has the
// script and says the pass is still owed.

test("Entrar reads its one field with where the code comes from, and a refusal on the field it is about", async ({ page }) => {
  await page.goto("/entrar");
  await expect(page.locator("body")).toMatchAriaSnapshot(`
    - main:
      - paragraph: Gamo Cafe
      - heading "Entrar" [level=1]
      - paragraph: Pídeselo a un administrador. Sirve una sola vez y dura 10 minutos.
      - textbox "Código de acceso"
      - button "Entrar"
  `);
  const code = page.getByLabel("Código de acceso");
  await expect(code).toBeFocused();
  await expect(code).toHaveAccessibleDescription("Pídeselo a un administrador. Sirve una sola vez y dura 10 minutos.");

  await code.fill("ZZZZ2222");
  await page.getByRole("button", { name: "Entrar" }).click();
  // Said at once, and again whenever the field is read.
  await expect(page.getByRole("alert")).toHaveText("Ese código no es válido o ya venció. Pide uno nuevo.");
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(code).toHaveAccessibleDescription(/Ese código no es válido o ya venció\. Pide uno nuevo\.$/);
});

test("the shell reads a way past itself, who is signed in and where they are, then the screen", async ({ page, signInAs }) => {
  await signInAs("worker", "Beto");
  await page.goto("/inicio");
  await expect(page.locator("body")).toMatchAriaSnapshot(`
    - link "Ir al contenido"
    - banner:
      - paragraph: Gamo Cafe
      - paragraph: Beto · Empleado
    - navigation "Principal":
      - list:
        - listitem:
          - link "Inicio"
        - listitem:
          - link "Vender"
        - listitem:
          - link "Cuentas"
        - listitem:
          - link "Más"
    - main:
      - heading "Hola, Beto" [level=1]
      - link /Nueva venta Hoy llevas vendido \\$0\\.00/
      - link /Cobraste hoy \\$0\\.00 Efectivo \\$0\\.00 Transferencia \\$0\\.00/
      - link /Cuentas abiertas 0/
      - link "Clientes"
  `);
  // Where the User is, is a state of the link and not only its color.
  await expect(page.getByRole("navigation", { name: "Principal" }).locator('[aria-current="page"]')).toHaveText("Inicio");
  // One screen, one main heading, and a title that names it.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page).toHaveTitle("Inicio · Gamo Cafe");
});

test("a sale reads its Items, its total, the Payment and what was recorded, each step from its heading", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas });
  await addItem({ name: "Café de olla", price: 2500, category: bebidas });
  await page.goto("/");
  await select(page, [["Agua mineral", 2]]);

  const main = page.getByRole("main");
  await expect(main).toMatchAriaSnapshot(`
    - main:
      - heading "Vender" [level=1]
      - button "Vaciar"
      - searchbox "Buscar producto"
      - region "Bebidas":
        - heading "Bebidas" [level=2]
        - list:
          - listitem:
            - button "Agua mineral $18.50"
            - button "Quitar uno de Agua mineral"
            - text: "2"
            - button "Agregar uno de Agua mineral"
          - listitem:
            - button "Café de olla $25.00"
      - paragraph: 2 productos, total $37.00
      - region "Total":
        - paragraph: 2 productos $37.00
        - button "Cobrar"
  `);
  // What the selection adds up to is said when it changes, without taking the focus.
  await expect(main.locator('[aria-live="polite"]').filter({ hasText: "2 productos, total $37.00" })).toHaveCount(1);

  await review(page);
  await expect(page.getByRole("heading", { name: "Cobrar", level: 1 })).toBeFocused();
  await page.getByLabel("Efectivo que te entregan (opcional)").fill("50");
  await expect(main).toMatchAriaSnapshot(`
    - main:
      - button "Cambiar productos"
      - heading "Cobrar" [level=1]
      - region "Selección":
        - heading "Selección" [level=2]
        - list:
          - listitem: 2 × Agua mineral $37.00
        - paragraph: Total $37.00
      - region "Cliente y nota (opcionales)":
        - heading "Cliente y nota (opcionales)" [level=2]
        - searchbox "Cliente"
        - textbox "Nota (opcional)"
      - region "Pago":
        - heading "Pago" [level=2]
        - radiogroup "Forma de pago":
          - radio "Efectivo" [checked]
          - radio "Transferencia"
        - button "Cobrar solo una parte"
        - textbox "Efectivo que te entregan (opcional)": "50"
        - paragraph: "Cambio: $13.00"
      - button "Registrar pago de $37.00"
      - button "Dejar abierta"
      - paragraph: "Sin pago: la cuenta queda abierta."
  `);

  await page.getByRole("button", { name: "Registrar pago de $37.00" }).click();
  await expect(page.getByRole("heading", { name: "Pago registrado", level: 1 })).toBeFocused();
  await expect(main).toMatchAriaSnapshot(`
    - main:
      - heading "Pago registrado" [level=1]
      - status: $37.00 en efectivo. Cuenta pagada.
      - region "Cambio": Cambio $13.00
      - button "Nueva venta"
      - region "Selección":
        - heading "Selección" [level=2]
        - list:
          - listitem: 2 × Agua mineral $37.00
        - paragraph: Total $37.00
      - term: Pago
      - definition: $37.00 · Efectivo
  `);
});

test("Día reads its figures under a heading of their own: what was received before what was consumed, each by its name", async ({
  page,
  signInAs,
  addItem,
}) => {
  await signInAs("admin", "Ana");
  await addItem({ name: "Agua mineral", price: 1850 });
  await page.goto("/dia");
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Día" [level=1]
      - textbox "Desde"
      - textbox "Hasta"
      - button "Ver"
      - region:
        - heading [level=2]
        - term: Cobrado
        - definition: $0.00
        - definition: El dinero que se recibió.
        - term: Efectivo
        - definition: $0.00
        - term: Transferencia
        - definition: $0.00
        - term: Vendido
        - definition: $0.00
        - definition: Lo que se consumió, pagado o no.
      - link /Por cobrar/
  `);
});

test("an Adjustment reads its Item, its reason with what it does, its units and the action by its effect", async ({
  page,
  signInAs,
  addItem,
}) => {
  const ana = await signInAs("admin", "Ana");
  await addItem({ name: "Agua mineral", price: 1850, minimum: 6, stock: { units: 5, by: ana } });
  await page.goto("/inventario");
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Inventario" [level=1]
      - link "Registrar entrada"
      - link "Contar existencias"
      - navigation "Más de inventario":
        - list:
          - listitem:
            - link "Registrar merma o consumo interno"
          - listitem:
            - link "Ajustes recientes"
          - listitem:
            - link "Diferencias de los conteos"
      - region "Existencias":
        - heading "Existencias" [level=2]
        - search:
          - searchbox "Buscar producto"
          - paragraph: "1 por reponer: en su mínimo o menos."
        - list "Existencias":
          - listitem "Agua mineral":
            - link "Agua mineral Reponer Existencias 5 Mínimo 6 Registrar ajuste"
  `);

  await page.getByRole("link", { name: "Registrar entrada", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Registrar entrada", level: 1 })).toBeFocused();
  await page.getByLabel("Producto", { exact: true }).selectOption({ label: "Agua mineral" });
  await page.getByLabel("Unidades", { exact: true }).fill("4");
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - button "Inventario"
      - heading "Registrar entrada" [level=1]
      - combobox "Producto"
      - radiogroup "Motivo":
        - radio "Entrada Suma unidades" [checked]
        - radio "Merma Resta unidades"
        - radio "Consumo interno Resta unidades"
      - textbox "Unidades": "4"
      - textbox "Nota (opcional)"
      - paragraph: "Suma 4: Agua mineral pasa de 5 a 9 en existencias."
      - button "Registrar entrada de 4"
  `);
});
