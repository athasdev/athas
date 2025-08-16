import type React from "react";
import { createContext, useCallback, useContext, useState } from "react";

interface Toast {
  id: string;
  message: string;
  type?: "info" | "success" | "warning" | "error";
  duration?: number;
  isExiting?: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextType {
  toasts: Toast[];
  showToast: (toast: Omit<Toast, "id">) => string; // Return toast ID
  updateToast: (id: string, updates: Partial<Omit<Toast, "id">>) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((toast) => (toast.id === id ? { ...toast, isExiting: true } : toast)),
    );

    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 300);
  }, []);

  const updateToast = useCallback((id: string, updates: Partial<Omit<Toast, "id">>) => {
    setToasts((prev) => prev.map((toast) => (toast.id === id ? { ...toast, ...updates } : toast)));
  }, []);

  const showToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = Date.now().toString();
      const newToast = { ...toast, id };

      setToasts((prev) => [...prev, newToast]);

      if (toast.duration !== 0) {
        setTimeout(() => {
          dismissToast(id);
        }, toast.duration || 5000);
      }

      return id; // Return the toast ID
    },
    [dismissToast],
  );

  return (
    <ToastContext.Provider value={{ toasts, showToast, updateToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};
