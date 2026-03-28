import type React from "react";
import { useCallback } from "react";
import { toast, useToastStore, type Toast } from "@/ui/toast";

interface ToastContextType {
  toasts: Toast[];
  showToast: (value: Omit<Toast, "id">) => string;
  updateToast: (id: string, updates: Partial<Omit<Toast, "id">>) => void;
  dismissToast: (id: string) => void;
  hasToast: (id: string) => boolean;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => children;

export const useToast = (): ToastContextType => {
  const toasts = useToastStore.use.toasts();

  const showToast = useCallback((value: Omit<Toast, "id">) => toast.show(value), []);
  const updateToast = useCallback(
    (id: string, updates: Partial<Omit<Toast, "id">>) => toast.update(id, updates),
    [],
  );
  const dismissToast = useCallback((id: string) => toast.dismiss(id), []);
  const hasToast = useCallback((id: string) => toast.has(id), []);

  return {
    toasts,
    showToast,
    updateToast,
    dismissToast,
    hasToast,
  };
};
