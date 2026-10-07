import { normalizeName } from "./normalize-name";

/**
 * The line drawing that goes beside a Category's name on Vender (UI redesign
 * §3.3): one of a small set, chosen by the words of the name. A Category none
 * of them fits has no drawing, and works the same. `CategoryDrawing` in
 * `~/components/icons` draws them.
 *
 * Safe in the browser: no Effect import.
 */
export type CategoryDrawingName = "cup" | "glass" | "bread" | "plate" | "candy" | "snack" | "fruit";

/** A drawing fits a name with a word that starts like one of these. First match wins. */
const FITS: ReadonlyArray<readonly [CategoryDrawingName, ReadonlyArray<string>]> = [
  ["cup", ["cafe", "caliente", "chocolate", "atole"]],
  ["glass", ["bebida", "refresco", "agua", "jugo", "licuado"]],
  ["bread", ["pan", "reposteria", "pastel", "postre", "galleta"]],
  ["plate", ["comida", "desayuno", "almuerzo", "guisado", "antojito", "torta", "sandwich", "taco"]],
  ["candy", ["dulce", "golosina", "chicle", "paleta"]],
  ["snack", ["botana", "fritura", "papa", "snack"]],
  ["fruit", ["fruta", "verdura"]],
];

export function categoryDrawing(categoryName: string): CategoryDrawingName | null {
  const words = normalizeName(categoryName).split(" ");
  for (const [drawing, starts] of FITS) {
    if (words.some((word) => starts.some((start) => word.startsWith(start)))) return drawing;
  }
  return null;
}
