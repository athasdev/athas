import { useCallback } from "react";
import { toast as sonnerToast } from "sonner";
import type { ToastInput } from "@/features/notifications/types/notifications.types";

interface ToastContextType {
  showToast: (value: ToastInput) => string;
  updateToast: (id: string, updates: Partial<ToastInput>) => void;
  dismissToast: (id: string) => void;
  hasToast: (id: string) => boolean;
}

const activeToasts = new Map<string, ToastInput>();

function clearActiveToast(id: string) {
  if (!activeToasts.delete(id)) return;
  window.dispatchEvent(new CustomEvent("toast-dismissed", { detail: { toastId: id } }));
}

function showToast(value: ToastInput, forcedId?: string) {
  const id = forcedId ?? value.key ?? globalThis.crypto?.randomUUID?.() ?? Date.now().toString();
  const options = {
    id,
    description: value.description,
    duration: value.duration,
    icon: value.icon,
    action: value.action,
    onDismiss: () => clearActiveToast(id),
    onAutoClose: () => clearActiveToast(id),
  };

  activeToasts.set(id, value);
  switch (value.type) {
    case "success":
      sonnerToast.success(value.message, options);
      break;
    case "warning":
      sonnerToast.warning(value.message, options);
      break;
    case "error":
      sonnerToast.error(value.message, options);
      break;
    default:
      sonnerToast.info(value.message, options);
      break;
  }

  return id;
}

export const useToast = (): ToastContextType => {
  const updateToast = useCallback((id: string, updates: Partial<ToastInput>) => {
    const current = activeToasts.get(id);
    if (!current) return;
    showToast({ ...current, ...updates }, id);
  }, []);

  const dismissToast = useCallback((id: string) => {
    sonnerToast.dismiss(id);
    clearActiveToast(id);
  }, []);

  return {
    showToast,
    updateToast,
    dismissToast,
    hasToast: (id) => activeToasts.has(id),
  };
};
