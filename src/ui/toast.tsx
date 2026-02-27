import { CircleAlert, CircleCheck, CircleQuestionMark, CircleX, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useToast } from "@/features/layout/contexts/toast-context";

export const ToastContainer = () => {
  const { toasts, dismissToast } = useToast();

  return createPortal(
    <div className="fixed right-4 bottom-16 z-[10000] flex flex-col gap-2 text-text">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="relative flex min-w-[280px] max-w-[380px] flex-col gap-2 rounded-xl border border-border bg-primary-bg/95 px-3 py-2.5 shadow-xl backdrop-blur-sm"
        >
          <div className="flex items-start gap-2">
            {toast.type === "error" && (
              <CircleX size={14} className="mt-0.5 shrink-0 text-red-400" />
            )}
            {toast.type === "warning" && (
              <CircleAlert size={14} className="mt-0.5 shrink-0 text-yellow-400" />
            )}
            {toast.type === "success" && (
              <CircleCheck size={14} className="mt-0.5 shrink-0 text-green-400" />
            )}
            {toast.type === "info" && (
              <CircleQuestionMark size={14} className="mt-0.5 shrink-0 text-blue-400" />
            )}

            <p className="ui-font flex-1 text-text text-xs">{toast.message}</p>

            <button
              onClick={() => dismissToast(toast.id)}
              className="shrink-0 rounded p-0.5 transition-colors hover:bg-hover"
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
                className="ui-font rounded bg-hover px-3 py-1 text-[10px] text-text uppercase tracking-wider transition-colors hover:bg-border"
              >
                {toast.action.label}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
};
