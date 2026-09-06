import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import {
  AnimatePresence,
  motion,
  useReducedMotionConfig,
  useIsPresent,
  type HTMLMotionProps,
} from "motion/react";
import { forwardRef } from "react";
import type * as React from "react";
import { instantTransition, quickTransition } from "@/utils/motion";
import { cn } from "@/utils/cn";

const attachmentVariants = cva(
  "group/attachment relative flex w-fit max-w-[min(16rem,100%)] min-w-0 shrink-0 ui-text-sm gap-2 rounded-lg bg-attachment text-foreground outline-none shadow-(--attachment-shadow) transition-[background-color,box-shadow] duration-fast ease-smooth motion-reduce:transition-none hover:bg-attachment-hover hover:shadow-(--attachment-hover-shadow) focus-within:ring-1 focus-within:ring-primary/35 focus-visible:ring-1 focus-visible:ring-primary/35 has-data-[slot=attachment-content]:px-2 has-data-[slot=attachment-content]:py-1.5 has-data-[slot=attachment-media]:p-1.5 data-[state=error]:ring-1 data-[state=error]:ring-destructive/30 data-[state=idle]:border data-[state=idle]:border-dashed data-[state=idle]:border-border",
  {
    variants: {
      orientation: {
        horizontal: "items-center",
        vertical: "w-24 flex-col has-data-[slot=attachment-content]:w-30",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
    },
  },
);

type AttachmentState = "idle" | "uploading" | "processing" | "error" | "done";

type AttachmentProps = HTMLMotionProps<"div"> &
  VariantProps<typeof attachmentVariants> & {
    state?: AttachmentState;
  };

const Attachment = forwardRef<HTMLDivElement, AttachmentProps>(function Attachment(
  { className, state = "done", orientation = "horizontal", ...props },
  ref,
) {
  const reduceMotion = useReducedMotionConfig();
  const isPresent = useIsPresent();
  return (
    <motion.div
      ref={ref}
      layout={reduceMotion ? false : "position"}
      initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.96, y: reduceMotion ? 0 : 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.9, y: reduceMotion ? 0 : -2 }}
      transition={
        reduceMotion
          ? instantTransition
          : {
              ...quickTransition,
              layout: { type: "spring", stiffness: 500, damping: 36 },
            }
      }
      inert={!isPresent || undefined}
      data-slot="attachment"
      data-state={state}
      data-orientation={orientation}
      className={cn(attachmentVariants({ orientation }), className)}
      {...props}
    />
  );
});

const attachmentMediaVariants = cva(
  "relative flex aspect-square w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-attachment-media text-muted-foreground group-data-[orientation=vertical]/attachment:w-full group-data-[state=error]/attachment:bg-destructive/10 group-data-[state=error]/attachment:text-destructive [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 group-data-[orientation=vertical]/attachment:[&_svg:not([class*='size-'])]:size-6",
  {
    variants: {
      variant: {
        icon: "",
        image:
          "opacity-60 group-data-[state=done]/attachment:opacity-100 group-data-[state=idle]/attachment:opacity-100 *:[img]:aspect-square *:[img]:w-full *:[img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "icon",
    },
  },
);

function AttachmentMedia({
  className,
  variant = "icon",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof attachmentMediaVariants>) {
  return (
    <div
      data-slot="attachment-media"
      data-variant={variant}
      className={cn(attachmentMediaVariants({ variant }), className)}
      {...props}
    />
  );
}

function AttachmentContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-content"
      className={cn(
        "max-w-full min-w-0 flex-1 leading-tight group-data-[orientation=vertical]/attachment:px-1",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-title"
      className={cn(
        "block max-w-full min-w-0 truncate font-medium group-data-[state=processing]/attachment:animate-pulse group-data-[state=uploading]/attachment:animate-pulse",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentDescription({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-description"
      className={cn(
        "mt-0.5 block max-w-full min-w-0 truncate text-subtle-foreground group-data-[state=error]/attachment:text-destructive/80",
        className,
      )}
      {...props}
    />
  );
}

type AttachmentTriggerProps = useRender.ComponentProps<"button">;

function AttachmentTrigger({ className, render, ref, type, ...props }: AttachmentTriggerProps) {
  return useRender({
    defaultTagName: "button",
    render,
    ref,
    props: {
      "data-slot": "attachment-trigger",
      type: render ? undefined : (type ?? "button"),
      className: cn("absolute inset-0 z-10 outline-none", className),
      ...props,
    },
  });
}

function AttachmentGroup({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-group"
      className={cn(
        "relative flex min-w-0 flex-wrap items-start gap-1.5 py-1 empty:hidden",
        className,
      )}
      {...props}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {children}
      </AnimatePresence>
    </div>
  );
}

export {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
};
