import { X } from "lucide-react";
import type React from "react";
import { useToast } from "@/contexts/toast-context";

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useToast();

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`relative flex min-w-[300px] max-w-[500px] animate-slide-in-right items-center gap-3 rounded-lg px-4 py-3 pr-8 shadow-lg ${toast.type === "error" ? "bg-red-900/90 text-red-100" : ""} ${toast.type === "warning" ? "bg-yellow-900/90 text-yellow-100" : ""} ${toast.type === "success" ? "bg-green-900/90 text-green-100" : ""} ${!toast.type || toast.type === "info" ? "bg-gray-800/90 text-gray-100" : ""} `}
        >
          <div className="flex-1">
            <p className="text-sm">{toast.message}</p>
            {toast.action && (
              <button
                onClick={toast.action.onClick}
                className="mt-2 rounded bg-white/20 px-3 py-1 font-medium text-xs transition-colors hover:bg-white/30"
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button
            onClick={() => dismissToast(toast.id)}
            className="absolute top-2 right-2 rounded p-1 transition-colors hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};
