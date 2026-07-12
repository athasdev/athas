import { Dialog as DialogPrimitive } from "@base-ui/react";
import { cva } from "class-variance-authority";
import { motion, useReducedMotion } from "framer-motion";
import { type IconProps as AppIconProps, XIcon as X } from "@/ui/icons";
import { type ReactNode } from "react";
import { instantTransition, overlayEntrance, overlayTransition } from "@/ui/motion";
import { resolveEscapeGuard } from "@/utils/keyboard/escape-guard";
import { cn } from "@/utils/cn";

interface DialogProps {
  children: ReactNode;
  onClose: () => void;
  title: ReactNode;
  icon?: React.ForwardRefExoticComponent<
    Omit<AppIconProps, "ref"> & React.RefAttributes<SVGSVGElement>
  >;
  headerActions?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  headerBorder?: boolean;
  footerBorder?: boolean;
  classNames?: Partial<{
    backdrop: string;
    modal: string;
    header: string;
    title: string;
    headerActions: string;
    content: string;
  }>;
}

const dialogContentVariants = cva(
  [
    "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[9999]",
    "flex max-h-[90vh] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-primary-bg shadow-[var(--shadow-dialog)]",
    "focus:outline-none",
  ],
  {
    variants: {
      size: {
        sm: "w-full max-w-sm",
        md: "w-full max-w-md",
        lg: "w-full max-w-lg",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const Dialog = ({
  children,
  onClose,
  title,
  icon: Icon,
  headerActions,
  footer,
  size = "md",
  classNames,
}: DialogProps) => {
  const prefersReducedMotion = useReducedMotion();
  const popupMotion = prefersReducedMotion
    ? {
        initial: false as const,
        animate: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
        exit: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
        transition: instantTransition,
      }
    : overlayEntrance;

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open, eventDetails) => {
        if (open) return;

        if (eventDetails.reason === "escape-key") {
          const target = eventDetails.event.target as HTMLElement | null;
          const activeElement =
            typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
          const { dismissTarget, blurTarget } = resolveEscapeGuard(target, activeElement);

          if (dismissTarget) {
            eventDetails.cancel();
            return;
          }

          if (blurTarget) {
            eventDetails.cancel();
            blurTarget.blur();
            return;
          }
        }

        onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          render={
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={prefersReducedMotion ? instantTransition : overlayTransition}
            />
          }
          className={cn("fixed inset-0 z-[9998] bg-black/20", classNames?.backdrop)}
        />

        <DialogPrimitive.Popup
          aria-describedby={undefined}
          render={
            <motion.div
              initial={popupMotion.initial}
              animate={popupMotion.animate}
              exit={popupMotion.exit}
              transition={popupMotion.transition}
            />
          }
          data-dialog-content=""
          className={cn(dialogContentVariants({ size }), classNames?.modal)}
        >
          <div
            className={cn(
              "flex shrink-0 items-center justify-between bg-primary-bg px-4 py-3",
              classNames?.header,
            )}
          >
            <div className={cn("flex min-w-0 items-center gap-2", classNames?.title)}>
              {Icon && <Icon className="text-text-lighter" />}
              <DialogPrimitive.Title className="min-w-0 font-sans ui-text-base font-medium text-text">
                {title}
              </DialogPrimitive.Title>
            </div>

            <div className={cn("flex items-center gap-1", classNames?.headerActions)}>
              {headerActions}
              <DialogPrimitive.Close
                className="flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent text-text-lighter transition-[transform,background-color,border-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] hover:border-border/70 hover:bg-hover hover:text-text active:scale-[var(--app-press-scale)]"
                aria-label="Close dialog"
              >
                <X />
              </DialogPrimitive.Close>
            </div>
          </div>

          <div className={cn("flex-1 overflow-y-auto p-4", classNames?.content)}>{children}</div>

          {footer && (
            <div className="flex shrink-0 items-center justify-end gap-2 px-4 py-3">{footer}</div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default Dialog;
