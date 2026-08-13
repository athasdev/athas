import { cva } from "class-variance-authority";

export const overlayBackdrop = cva("fixed inset-0 bg-black/20");

export const floatingSurface = cva(
  "rounded-lg bg-surface/98 font-sans ui-text-chrome text-foreground shadow-(--shadow-card) ring-1 ring-border/50 outline-none backdrop-blur-sm",
);

export const overlaySurface = cva(
  "rounded-xl bg-background text-foreground shadow-(--shadow-dialog) ring-1 ring-border/70 outline-none",
);
