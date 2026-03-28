import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva } from "class-variance-authority";
import { motion } from "framer-motion";
import { type LucideProps, X } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/utils/cn";

interface DialogProps {
  children: ReactNode;
  onClose: () => void;
  title: string;
  icon?: React.ForwardRefExoticComponent<
    Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
  >;
  headerActions?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  headerBorder?: boolean;
  classNames?: Partial<{
    backdrop: string;
    modal: string;
    content: string;
  }>;
}

const dialogContentVariants = cva(
  [
    "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[9999]",
    "mx-4 flex max-h-[90vh] flex-col overflow-hidden rounded-xl border border-border bg-primary-bg shadow-2xl",
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
  headerBorder = true,
  classNames,
}: DialogProps) => {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "fixed inset-0 z-[9998] bg-black/20 backdrop-blur-[1px]",
              classNames?.backdrop,
            )}
          />
        </DialogPrimitive.Overlay>

        <DialogPrimitive.Content asChild onEscapeKeyDown={() => onClose()}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className={cn(dialogContentVariants({ size }), classNames?.modal)}
          >
            <div
              className={cn(
                "flex shrink-0 items-center justify-between bg-primary-bg px-4 py-3",
                headerBorder && "border-border border-b",
              )}
            >
              <div className="flex items-center gap-2">
                {Icon && <Icon className="text-text-lighter" />}
                <DialogPrimitive.Title className="ui-font ui-text-md font-medium text-text">
                  {title}
                </DialogPrimitive.Title>
              </div>

              <div className="flex items-center gap-1">
                {headerActions}
                <DialogPrimitive.Close asChild>
                  <button
                    className="flex size-6 shrink-0 items-center justify-center rounded-lg border border-transparent text-text-lighter transition-colors hover:border-border/70 hover:bg-hover hover:text-text"
                    aria-label="Close dialog"
                  >
                    <X />
                  </button>
                </DialogPrimitive.Close>
              </div>
            </div>

            <div className={cn("flex-1 overflow-y-auto p-4", classNames?.content)}>{children}</div>

            {footer && (
              <div className="flex shrink-0 items-center justify-end gap-2 border-border border-t px-4 py-3">
                {footer}
              </div>
            )}
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default Dialog;
