import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface Toast {
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
    dismiss: (id: string) => void;
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
    dismiss: (id) => {
      set((state) => ({
        toasts: state.toasts.map((t) => (t.id === id ? { ...t, isExiting: true } : t)),
      }));

      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, 300);
    },
    info: (message) => get().actions.show({ message, type: "info" }),
    success: (message) => get().actions.show({ message, type: "success" }),
    warning: (message) => get().actions.show({ message, type: "warning" }),
    error: (message) => get().actions.show({ message, type: "error" }),
  },
}));

export const useToastStore = createSelectors(useToastStoreBase);

// Standalone toast utility for use outside React components
export const toast = {
  show: (t: Omit<Toast, "id">) => useToastStoreBase.getState().actions.show(t),
  dismiss: (id: string) => useToastStoreBase.getState().actions.dismiss(id),
  info: (message: string) => useToastStoreBase.getState().actions.info(message),
  success: (message: string) => useToastStoreBase.getState().actions.success(message),
  warning: (message: string) => useToastStoreBase.getState().actions.warning(message),
  error: (message: string) => useToastStoreBase.getState().actions.error(message),
};
