import * as React from "react"
import { cn } from "cn"

// The app's own drawing: the preset's icon library is not in the bundle.
import { UnfoldDrawing } from "~/components/icons"

// One size, the field's: the preset's two are both smaller than a target may be.
type NativeSelectProps = Omit<React.ComponentProps<"select">, "size">

function NativeSelect({ className, ...props }: NativeSelectProps) {
  return (
    <div
      className={cn(
        // As wide as its room, as `Input` is.
        "group/native-select relative w-full has-[select:disabled]:opacity-50",
        className
      )}
      data-slot="native-select-wrapper"
    >
      <select
        data-slot="native-select"
        // Larger than the preset, with the card's cream fill, as `Input` is: 56px tall, 18px text (UI redesign §8).
        className="h-14 w-full min-w-0 appearance-none rounded-xl border border-input bg-card py-1 pr-12 pl-4.5 text-lg text-ellipsis shadow-[0_1px_2px_rgb(31_26_23/0.05)] transition-[color,border-color,box-shadow] outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
        {...props}
      />
      <span data-slot="native-select-icon" className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-muted-foreground select-none">
        <UnfoldDrawing className="size-5" />
      </span>
    </div>
  )
}

// An option is drawn by the phone's own list of choices, so it carries no class of the app's.
function NativeSelectOption(props: React.ComponentProps<"option">) {
  return <option data-slot="native-select-option" {...props} />
}

export { NativeSelect, NativeSelectOption }
