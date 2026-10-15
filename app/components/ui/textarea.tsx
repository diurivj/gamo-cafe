import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Larger than the preset, with the card's cream fill, as `Input` is:
        // 18px text, and tall enough for two lines before it grows (UI redesign §8).
        "flex field-sizing-content min-h-24 w-full resize-none rounded-xl border border-input bg-card px-4.5 py-3 text-lg wrap-break-word shadow-[inset_0_1px_2px_rgb(31_26_23/0.05)] transition-[color,border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
