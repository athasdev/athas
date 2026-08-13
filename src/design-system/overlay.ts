import { cva } from "class-variance-authority";

export const overlaySurface = cva(
  "rounded-xl bg-background text-foreground shadow-(--shadow-dialog) ring-1 ring-border/70 outline-none",
);
