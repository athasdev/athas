import { CircleAlert, CircleCheck, CircleQuestionMark, CircleX, X } from "lucide-react";
import { useToast } from "@/features/layout/contexts/toast-context";
import { cn } from "@/utils/cn";

export const ToastContainer = () => {
  const { toasts, dismissToast } = useToast();

  return (
    <div className="fixed right-4 bottom-16 z-50 flex flex-col gap-2 text-text">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "relative flex min-w-[280px] max-w-[380px] flex-col gap-2",
            toast.isExiting ? "animate-slide-out-right" : "animate-slide-in-right",
            "rounded border border-border bg-primary-bg/95 px-3 py-2 shadow-lg backdrop-blur-sm",
          )}
        >
          <div className="flex items-start gap-2">
            {toast.type === "error" && (
              <CircleX size={14} className="mt-0.5 flex-shrink-0 text-red-400" />
            )}
            {toast.type === "warning" && (
              <CircleAlert size={14} className="mt-0.5 flex-shrink-0 text-yellow-400" />
            )}
            {toast.type === "success" && (
              <CircleCheck size={14} className="mt-0.5 flex-shrink-0 text-green-400" />
            )}
            {toast.type === "info" && (
              <CircleQuestionMark size={14} className="mt-0.5 flex-shrink-0 text-blue-400" />
            )}

            <p className="flex-1 font-mono text-text text-xs">{toast.message}</p>

            <button
              onClick={() => dismissToast(toast.id)}
              className="flex-shrink-0 rounded p-0.5 transition-colors hover:bg-hover"
            >
              <X size={12} className="text-text-lighter" />
            </button>
          </div>

          {toast.action && (
            <div className="flex justify-end border-border border-t pt-2">
              <button
                onClick={() => {
                  toast.action?.onClick();
                  dismissToast(toast.id);
                }}
                className="rounded bg-hover px-3 py-1 font-mono text-[10px] text-text uppercase tracking-wider transition-colors hover:bg-border"
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
