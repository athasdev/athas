import type React from "react";
import { type Toast, useToast as useUiToast } from "@/ui/toast";

interface ToastContextType {
  toasts: Toast[];
  showToast: (value: Omit<Toast, "id">) => string;
  updateToast: (id: string, updates: Partial<Omit<Toast, "id">>) => void;
  dismissToast: (id: string) => void;
  hasToast: (id: string) => boolean;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => children;

export const useToast = (): ToastContextType => {
  const { toasts, showToast, updateToast, dismissToast, hasToast } = useUiToast();

  return {
    toasts,
    showToast,
    updateToast,
    dismissToast,
    hasToast,
  };
};
