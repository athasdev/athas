import { cva, type VariantProps } from "class-variance-authority";

const statusDotVariants = cva("inline-block size-1.5 shrink-0 rounded-full", {
  variants: {
    tone: {
      /** Something healthy that keeps running, such as a dev server. */
      live: "bg-success motion-safe:animate-pulse",
    },
  },
  defaultVariants: { tone: "live" },
});

/** A small dot for a steady state, read alongside a label that says what it is. */
export function StatusDot({ tone }: VariantProps<typeof statusDotVariants>) {
  return <span aria-hidden data-slot="status-dot" className={statusDotVariants({ tone })} />;
}
