import { CircleAlert, CircleCheck, CircleQuestionMark, CircleX, X } from "lucide-react";
import { useToast } from "@/contexts/toast-context";
import { cn } from "@/utils/cn";

export const ToastContainer = () => {
  const { toasts, dismissToast } = useToast();

  return (
    <div className="fixed right-4 bottom-16 z-50 flex flex-col gap-2 text-text">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "relative flex min-w-[250px] max-w-[320px] flex-col gap-2",
            toast.isExiting ? "animate-slide-out-right" : "animate-slide-in-right",
            "rounded-md border border-border/50 bg-secondary-bg/95 px-3 py-2 shadow-sm backdrop-blur-sm",
          )}
        >
          <div className="flex items-start gap-2">
            {toast.type === "error" && <CircleX size={12} className="mt-0.5 text-error/80" />}
            {toast.type === "warning" && (
              <CircleAlert size={12} className="mt-0.5 text-warning/80" />
            )}
            {toast.type === "success" && (
              <CircleCheck size={12} className="mt-0.5 text-success/80" />
            )}
            {toast.type === "info" && (
              <CircleQuestionMark size={12} className="mt-0.5 text-info/80" />
            )}

            <p className="flex-1 text-sm text-text/90">{toast.message}</p>

            <button
              onClick={() => dismissToast(toast.id)}
              className="rounded p-0.5 transition-colors hover:bg-white/10"
            >
              <X size={12} className="text-text-lighter" />
            </button>
          </div>

          {toast.action && (
            <div className="flex justify-end">
              <button
                onClick={toast.action.onClick}
                className="rounded bg-white/20 px-3 py-1 font-medium text-xs transition-colors hover:bg-white/30"
              >
                {toast.action.label}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
