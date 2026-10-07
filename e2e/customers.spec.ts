import { expect, test } from "./fixtures";
import { goTo } from "./support/navigate";

test("a Worker searches Clientes as they type and adds a new Customer", async ({ page, signInAs, addCustomer }) => {
  const beto = await signInAs("worker", "Beto");
  await addCustomer("Óscar Peña", { by: beto });
  await addCustomer("Osvaldo", { by: beto, note: "Papá de Leo" });
  await addCustomer("Rosa", { by: beto });

  await page.goto("/");
  await goTo(page, "Clientes");
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();

  // Matches appear while the name is typed, whatever its case or accents.
  const customers = page.getByRole("list", { name: "Clientes" });
  await page.getByLabel("Buscar o agregar").pressSequentially("OS");
  await expect(customers.getByRole("link")).toHaveText([/Óscar Peña/, /Osvaldo.*Papá de Leo/]);

  await page.getByLabel("Buscar o agregar").pressSequentially("car Pérez");
  await expect(customers).toHaveCount(0);
  await expect(page.getByText("Ningún cliente empieza con «OScar Pérez».")).toBeVisible();

  await page.getByLabel("Buscar o agregar").fill("Óscar Pérez");
  await page.getByLabel("Nota para «Óscar Pérez» (opcional)").fill("Paga los viernes");
  await page.getByRole("button", { name: "Agregar «Óscar Pérez»" }).click();

  // The new Customer's page says who added them.
  await expect(page).toHaveURL(/\/clientes\/[\w-]+$/);
  await expect(page.getByRole("heading", { name: "Óscar Pérez" })).toBeVisible();
  await expect(page.getByText("Paga los viernes")).toBeVisible();
  await expect(page.getByText(/^Lo agregó Beto el .+ a las \d{2}:\d{2}\.$/)).toBeVisible();

  // A Worker is offered nothing that only an Admin may do.
  await expect(page.getByRole("button", { name: "Guardar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retirar cliente" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the name of an active Customer is shown as a match and cannot be added again", async ({ page, signInAs, addCustomer }) => {
  const beto = await signInAs("worker");
  await addCustomer("María Núñez", { by: beto });

  await page.goto("/clientes");
  await page.getByLabel("Buscar o agregar").pressSequentially("maria nunez");

  await expect(page.getByRole("list", { name: "Clientes" }).getByRole("link", { name: "María Núñez" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Agregar/ })).toHaveCount(0);

  // One more letter makes it a new name.
  await page.getByLabel("Buscar o agregar").pressSequentially("s");
  await expect(page.getByRole("button", { name: "Agregar «maria nunezs»" })).toBeVisible();
});

test("an Admin renames, retires and restores a Customer", async ({ page, signInAs, addCustomer }) => {
  const ana = await signInAs("admin");
  const hugo = await addCustomer("Hugo", { by: ana });
  await addCustomer("Irene Vega", { by: ana });

  await page.goto(`/clientes/${hugo.id}`);

  // Another active Customer's name is refused in Spanish.
  await page.getByLabel("Nombre").fill("irene vega");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Ya hay un cliente con ese nombre.");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hugo");

  await page.getByLabel("Nombre").fill("Hugo Méndez");
  await page.getByLabel("Nota (opcional)").fill("Paga los viernes");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hugo Méndez");
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: "Retirar cliente" }).click();
  await expect(page.getByText("Retirado", { exact: true })).toBeVisible();
  await expect(page.getByText("Ya no se puede elegir para cuentas nuevas.")).toBeVisible();

  // Still listed on Clientes, marked.
  await goTo(page, "Clientes");
  await page.getByLabel("Buscar o agregar").pressSequentially("hugo");
  const row = page.getByRole("list", { name: "Clientes" }).getByRole("link", { name: /Hugo Méndez/ });
  await expect(row).toContainText("Retirado");
  await row.click();

  await page.getByRole("button", { name: "Restaurar cliente" }).click();
  await expect(page.getByRole("button", { name: "Retirar cliente" })).toBeVisible();
  await expect(page.getByText("Retirado", { exact: true })).toHaveCount(0);
});
