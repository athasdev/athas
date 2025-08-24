import { type LucideProps, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface Props {
  children: ReactNode;
  onClose: () => void;
  title: string;
  icon?: React.ForwardRefExoticComponent<
    Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
  >;
  classNames?: Partial<{
    backdrop: string;
    modal: string;
    content: string;
  }>;
}

const Dialog = ({ children, onClose, title, icon: Icon, classNames }: Props) => {
  return (
    <>
      {/* Backdrop */}
      <div
        className={cn("fixed inset-0 z-[9998] bg-black/20", classNames?.backdrop)}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={cn(
          "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[9999] transform",
          "overflow-hidden",
          "rounded-lg border border-border bg-primary-bg shadow-xl",
          "flex flex-col",
          classNames?.modal,
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-border border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {Icon && <Icon size={16} className="text-text" />}
            <h2 className="font-medium text-text">{title}</h2>
          </div>

          <button
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-hover"
          >
            <X size={14} className="text-text-lighter" />
          </button>
        </div>

        {/* Content */}
        <div className={cn("flex flex-1 overflow-hidden", classNames?.content)}>{children}</div>
      </div>
    </>
  );
};

export default Dialog;
