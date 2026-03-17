import { motion } from "framer-motion";
import { type LucideProps, X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

interface DialogProps {
  children: ReactNode;
  onClose: () => void;
  title: string;
  icon?: React.ForwardRefExoticComponent<
    Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
  >;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  classNames?: Partial<{
    backdrop: string;
    modal: string;
    content: string;
  }>;
}

const sizeClasses = {
  sm: "w-full max-w-sm",
  md: "w-full max-w-md",
  lg: "w-full max-w-lg",
};

const Dialog = ({
  children,
  onClose,
  title,
  icon: Icon,
  footer,
  size = "md",
  classNames,
}: DialogProps) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className={cn(
          "fixed inset-0 z-[9998] bg-black/20 backdrop-blur-[1px]",
          classNames?.backdrop,
        )}
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className={cn(
          "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[9999]",
          "flex max-h-[90vh] flex-col overflow-hidden",
          "rounded-2xl border border-border bg-primary-bg shadow-2xl",
          sizeClasses[size],
          "mx-4",
          classNames?.modal,
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-border border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {Icon && <Icon size={16} className="text-text" />}
            <h2 className="font-medium text-sm text-text">{title}</h2>
          </div>

          <button
            onClick={onClose}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-hover"
            aria-label="Close dialog"
          >
            <X size={14} className="text-text-lighter" />
          </button>
        </div>

        {/* Content */}
        <div className={cn("flex-1 overflow-y-auto p-4", classNames?.content)}>{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-border border-t px-4 py-3">
            {footer}
          </div>
        )}
      </motion.div>
    </>,
    document.body,
  );
};

export default Dialog;
