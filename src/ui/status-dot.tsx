import { cva, type VariantProps } from "class-variance-authority";

const statusDotVariants = cva("inline-block size-1.5 shrink-0 rounded-full", {
  variants: {
    tone: {
      /** Something healthy that keeps running, such as a dev server. */
      live: "bg-success motion-safe:animate-pulse",
      /** Something new the user has not looked at yet. */
      unread: "bg-primary",
      /** Something waiting on the user. */
      attention: "bg-warning",
      error: "bg-destructive",
    },
    /** `corner`: pinned to the top right of the control it marks, which must be `relative`. */
    placement: {
      inline: "",
      corner: "pointer-events-none absolute top-0.5 right-0.5",
    },
  },
  defaultVariants: { tone: "live", placement: "inline" },
});

/** A small dot for a steady state, read alongside a label that says what it is. */
export function StatusDot({ tone, placement }: VariantProps<typeof statusDotVariants>) {
  return (
    <span aria-hidden data-slot="status-dot" className={statusDotVariants({ tone, placement })} />
  );
}
