import type { ComponentProps } from "react";

import { SearchDrawing } from "./icons";
import { Input } from "./ui/input";

/**
 * A field that finds what is typed in it: an `Input` of `type="search"` with
 * the drawing of a lens at its start, so it is told from a field that records
 * something before anything is typed. Its label is the screen's, as for any
 * field.
 *
 *     <Label htmlFor="q">Buscar por cliente</Label>
 *     <SearchInput id="q" name="q" defaultValue={typed} />
 */
export function SearchInput({ className = "", ...props }: Omit<ComponentProps<typeof Input>, "type">) {
  return (
    <div className="relative">
      <SearchDrawing className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" {...props} className={`pl-12 ${className}`} />
    </div>
  );
}
