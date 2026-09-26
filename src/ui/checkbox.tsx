import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "@/ui/icons";
import { cn } from "@/utils/cn";

/**
 * `md` is the form control. `sm` is the quiet in-row variant for dense lists
 * such as staging rows: smaller, hairline border, stronger only on hover or
 * when checked.
 */
function Checkbox({
  className,
  size = "md",
  ...props
}: CheckboxPrimitive.Root.Props & { size?: "sm" | "md" }) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative inline-flex shrink-0 items-center justify-center bg-surface text-transparent outline-none transition-[background-color,border-color,color,box-shadow] duration-fast ease-smooth after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-focus data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-checked:hover:border-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-destructive",
        size === "md" && "size-4 rounded-sm border border-border-strong hover:border-foreground",
        size === "sm" && "size-3 rounded-sm border border-border hover:border-border-strong",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className={size === "sm" ? "size-2.5" : "size-3.5"} optical="lg" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
