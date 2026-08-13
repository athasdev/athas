import { cva } from "class-variance-authority";

export const overlayBackdrop = cva("fixed inset-0 bg-black/20");

export const overlaySurface = cva(
  "rounded-xl bg-background text-foreground shadow-(--shadow-dialog) ring-1 ring-border/70 outline-none",
);
