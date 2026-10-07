import { expect, it } from "vitest";

import { categoryDrawing } from "~/shared/category-drawing";

// UI redesign §3.3: a Category gets a drawing when one fits its name, and
// none otherwise. Adding a Category never needs a drawing.

it("fits a drawing to a Category by the words of its name, ignoring case and accents", () => {
  expect(categoryDrawing("Bebidas")).toBe("glass");
  expect(categoryDrawing("BEBIDAS CALIENTES")).toBe("cup");
  expect(categoryDrawing("Café")).toBe("cup");
  expect(categoryDrawing("Panadería")).toBe("bread");
  expect(categoryDrawing("Comida corrida")).toBe("plate");
  expect(categoryDrawing("Dulces y golosinas")).toBe("candy");
  expect(categoryDrawing("Botanas")).toBe("snack");
  expect(categoryDrawing("Fruta picada")).toBe("fruit");
});

it("has no drawing for a Category that none fits", () => {
  expect(categoryDrawing("Papelería")).toBeNull();
  expect(categoryDrawing("Categoría 1")).toBeNull();
  // "pan" inside a word is not bread.
  expect(categoryDrawing("Empanadas")).toBeNull();
  expect(categoryDrawing("")).toBeNull();
});
