import { create } from "zustand";
import { CircleAlert, CircleCheck, CircleQuestionMark, CircleX, X } from "lucide-react";
import { createPortal } from "react-dom";
import { createSelectors } from "@/utils/zustand-selectors";

export interface Toast {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  duration?: number;
  isExiting?: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastState {
  toasts: Toast[];
  actions: {
    show: (toast: Omit<Toast, "id">) => string;
    update: (id: string, updates: Partial<Omit<Toast, "id">>) => void;
    dismiss: (id: string) => void;
    has: (id: string) => boolean;
    info: (message: string) => string;
    success: (message: string) => string;
    warning: (message: string) => string;
    error: (message: string) => string;
  };
}

const useToastStoreBase = create<ToastState>()((set, get) => ({
  toasts: [],
  actions: {
    show: (toast) => {
      const id = Date.now().toString();
      const newToast = { ...toast, id };

      set((state) => ({ toasts: [...state.toasts, newToast] }));

      if (toast.duration !== 0) {
        setTimeout(() => {
          get().actions.dismiss(id);
        }, toast.duration || 5000);
      }

      return id;
    },
    update: (id, updates) => {
      set((state) => ({
        toasts: state.toasts.map((toast) => (toast.id === id ? { ...toast, ...updates } : toast)),
      }));
    },
    dismiss: (id) => {
      set((state) => ({
        toasts: state.toasts.map((toast) =>
          toast.id === id ? { ...toast, isExiting: true } : toast,
        ),
      }));

      window.dispatchEvent(new CustomEvent("toast-dismissed", { detail: { toastId: id } }));

      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
      }, 300);
    },
    has: (id) => get().toasts.some((toast) => toast.id === id),
    info: (message) => get().actions.show({ message, type: "info" }),
    success: (message) => get().actions.show({ message, type: "success" }),
    warning: (message) => get().actions.show({ message, type: "warning" }),
    error: (message) => get().actions.show({ message, type: "error" }),
  },
}));

export const useToastStore = createSelectors(useToastStoreBase);

export const toast = {
  show: (value: Omit<Toast, "id">) => useToastStoreBase.getState().actions.show(value),
  update: (id: string, updates: Partial<Omit<Toast, "id">>) =>
    useToastStoreBase.getState().actions.update(id, updates),
  dismiss: (id: string) => useToastStoreBase.getState().actions.dismiss(id),
  has: (id: string) => useToastStoreBase.getState().actions.has(id),
  info: (message: string) => useToastStoreBase.getState().actions.info(message),
  success: (message: string) => useToastStoreBase.getState().actions.success(message),
  warning: (message: string) => useToastStoreBase.getState().actions.warning(message),
  error: (message: string) => useToastStoreBase.getState().actions.error(message),
};

export const ToastContainer = () => {
  const toasts = useToastStore.use.toasts();

  return createPortal(
    <div className="fixed right-4 bottom-16 z-[10060] flex max-h-[min(60vh,32rem)] w-[min(calc(100vw-2rem),24rem)] flex-col gap-2 overflow-y-auto pr-1 text-text">
      {toasts.map((item) => (
        <div
          key={item.id}
          className="relative flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-primary-bg/95 px-3 py-2.5 shadow-xl backdrop-blur-sm"
        >
          <div className="flex items-start gap-2">
            {item.type === "error" && (
              <CircleX size={14} className="mt-0.5 shrink-0 text-red-400" />
            )}
            {item.type === "warning" && (
              <CircleAlert size={14} className="mt-0.5 shrink-0 text-yellow-400" />
            )}
            {item.type === "success" && (
              <CircleCheck size={14} className="mt-0.5 shrink-0 text-green-400" />
            )}
            {item.type === "info" && (
              <CircleQuestionMark size={14} className="mt-0.5 shrink-0 text-blue-400" />
            )}

            <p className="ui-font max-h-40 flex-1 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-xs text-text">
              {item.message}
            </p>

            <button
              onClick={() => toast.dismiss(item.id)}
              className="shrink-0 rounded p-0.5 transition-colors hover:bg-hover"
            >
              <X size={12} className="text-text-lighter" />
            </button>
          </div>

          {item.action && (
            <div className="flex justify-end border-border border-t pt-2">
              <button
                onClick={() => {
                  item.action?.onClick();
                  toast.dismiss(item.id);
                }}
                className="ui-font rounded bg-hover px-3 py-1 text-[10px] text-text uppercase tracking-wider transition-colors hover:bg-border"
              >
                {item.action.label}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
};
