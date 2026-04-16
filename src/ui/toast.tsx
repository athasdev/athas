import { create } from "zustand";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";
import { createSelectors } from "@/utils/zustand-selectors";

export interface Toast {
  id: string;
  key?: string;
  message: string;
  description?: string;
  type: "info" | "success" | "warning" | "error";
  duration?: number;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface NotificationEntry {
  id: string;
  key?: string;
  message: string;
  description?: string;
  type: Toast["type"];
  createdAt: number;
  updatedAt: number;
  read: boolean;
}

interface ToastState {
  toasts: Toast[];
  notifications: NotificationEntry[];
  actions: {
    show: (toast: Omit<Toast, "id">) => string;
    update: (id: string, updates: Partial<Omit<Toast, "id">>) => void;
    dismiss: (id: string) => void;
    dismissByKey: (key: string) => void;
    has: (id: string) => boolean;
    info: (message: string, description?: string) => string;
    success: (message: string, description?: string) => string;
    warning: (message: string, description?: string) => string;
    error: (message: string, description?: string) => string;
    markAllNotificationsRead: () => void;
    clearNotifications: () => void;
  };
}

const DISMISS_ANIMATION_MS = 300;
const MAX_NOTIFICATIONS = 20;

function removeToastLater(id: string) {
  setTimeout(() => {
    useToastStoreBase.setState((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  }, DISMISS_ANIMATION_MS);
}

function showWithSonner(nextToast: Toast) {
  const options = {
    id: nextToast.id,
    duration: nextToast.duration ?? 5000,
    icon: nextToast.icon,
    action: nextToast.action
      ? {
          label: nextToast.action.label,
          onClick: nextToast.action.onClick,
        }
      : undefined,
  };

  switch (nextToast.type) {
    case "success":
      sonnerToast.success(nextToast.message, options);
      break;
    case "warning":
      sonnerToast.warning(nextToast.message, options);
      break;
    case "error":
      sonnerToast.error(nextToast.message, options);
      break;
    default:
      sonnerToast.info(nextToast.message, options);
      break;
  }
}

function upsertNotification(
  notifications: NotificationEntry[],
  toast: Pick<Toast, "id" | "key" | "message" | "type"> & { description?: string },
) {
  const now = Date.now();
  const existingIndex = notifications.findIndex((item) =>
    toast.key ? item.key === toast.key : item.id === toast.id,
  );

  if (existingIndex >= 0) {
    const next = [...notifications];
    next[existingIndex] = {
      ...next[existingIndex],
      id: toast.id,
      key: toast.key,
      message: toast.message,
      description: toast.description,
      type: toast.type,
      updatedAt: now,
      read: false,
    };
    return next.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_NOTIFICATIONS);
  }

  return [
    {
      id: toast.id,
      key: toast.key,
      message: toast.message,
      description: toast.description,
      type: toast.type,
      createdAt: now,
      updatedAt: now,
      read: false,
    },
    ...notifications,
  ].slice(0, MAX_NOTIFICATIONS);
}

const useToastStoreBase = create<ToastState>()((set, get) => ({
  toasts: [],
  notifications: [],
  actions: {
    show: (toast) => {
      const existingToast = toast.key
        ? get().toasts.find((item) => item.key === toast.key)
        : undefined;

      if (existingToast) {
        const updatedToast = { ...existingToast, ...toast };
        set((state) => ({
          toasts: state.toasts.map((item) => (item.id === existingToast.id ? updatedToast : item)),
          notifications: upsertNotification(state.notifications, updatedToast),
        }));
        showWithSonner(updatedToast);
        return existingToast.id;
      }

      const id = globalThis.crypto?.randomUUID?.() ?? Date.now().toString();
      const nextToast: Toast = { ...toast, id };
      set((state) => ({
        toasts: [...state.toasts, nextToast],
        notifications: upsertNotification(state.notifications, nextToast),
      }));
      showWithSonner(nextToast);
      return id;
    },
    update: (id, updates) => {
      const existingToast = get().toasts.find((toast) => toast.id === id);
      if (!existingToast) return;

      const updatedToast = { ...existingToast, ...updates, id };
      set((state) => ({
        toasts: state.toasts.map((toast) => (toast.id === id ? updatedToast : toast)),
        notifications: upsertNotification(state.notifications, updatedToast),
      }));
      showWithSonner(updatedToast);
    },
    dismiss: (id) => {
      sonnerToast.dismiss(id);
      window.dispatchEvent(new CustomEvent("toast-dismissed", { detail: { toastId: id } }));
      removeToastLater(id);
    },
    dismissByKey: (key) => {
      const existingToast = get().toasts.find((toast) => toast.key === key);
      if (existingToast) {
        get().actions.dismiss(existingToast.id);
      }
    },
    has: (id) => get().toasts.some((toast) => toast.id === id),
    info: (message, description?) => get().actions.show({ message, description, type: "info" }),
    success: (message, description?) =>
      get().actions.show({ message, description, type: "success" }),
    warning: (message, description?) =>
      get().actions.show({ message, description, type: "warning" }),
    error: (message, description?) => get().actions.show({ message, description, type: "error" }),
    markAllNotificationsRead: () =>
      set((state) => ({
        notifications: state.notifications.map((item) => ({ ...item, read: true })),
      })),
    clearNotifications: () => set({ notifications: [] }),
  },
}));

export const useToastStore = createSelectors(useToastStoreBase);

export const toast = {
  show: (value: Omit<Toast, "id">) => useToastStoreBase.getState().actions.show(value),
  update: (id: string, updates: Partial<Omit<Toast, "id">>) =>
    useToastStoreBase.getState().actions.update(id, updates),
  dismiss: (id: string) => useToastStoreBase.getState().actions.dismiss(id),
  dismissByKey: (key: string) => useToastStoreBase.getState().actions.dismissByKey(key),
  has: (id: string) => useToastStoreBase.getState().actions.has(id),
  info: (message: string, description?: string) =>
    useToastStoreBase.getState().actions.info(message, description),
  success: (message: string, description?: string) =>
    useToastStoreBase.getState().actions.success(message, description),
  warning: (message: string, description?: string) =>
    useToastStoreBase.getState().actions.warning(message, description),
  error: (message: string, description?: string) =>
    useToastStoreBase.getState().actions.error(message, description),
};

export const useToast = () => {
  const toasts = useToastStore.use.toasts();
  const notifications = useToastStore.use.notifications();

  return {
    toasts,
    notifications,
    showToast: toast.show,
    updateToast: toast.update,
    dismissToast: toast.dismiss,
    dismissToastByKey: toast.dismissByKey,
    hasToast: toast.has,
    toast,
  };
};

export const ToastContainer = () => {
  return (
    <SonnerToaster
      position="bottom-right"
      expand={false}
      richColors
      theme="dark"
      icons={{
        success: <CheckCircle2 size={18} />,
        info: <Info size={18} />,
        warning: <AlertTriangle size={18} />,
        error: <AlertTriangle size={18} />,
        loading: <Loader2 size={18} className="animate-spin" />,
        close: <X size={14} />,
      }}
      toastOptions={{
        closeButton: true,
        className: "ui-font group",
        descriptionClassName: "ui-font",
        classNames: {
          toast:
            "group rounded-xl border border-border bg-primary-bg text-text shadow-xl backdrop-blur-sm",
          content: "pr-8",
          title: "ui-font text-sm leading-5 text-text",
          description: "ui-font text-sm leading-5 text-text-light",
          icon: "mt-0.5",
          success: "border-border",
          info: "border-border",
          warning: "border-border",
          error: "border-border",
          loading: "border-border",
          closeButton:
            "absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 border-none bg-transparent text-text-lighter hover:bg-hover hover:text-text",
          actionButton: "ui-font border-none bg-hover text-text hover:bg-border",
          cancelButton: "ui-font border-none bg-hover text-text hover:bg-border",
        },
        actionButtonStyle: {
          background: "var(--color-hover)",
          color: "var(--color-text)",
        },
        cancelButtonStyle: {
          background: "var(--color-hover)",
          color: "var(--color-text)",
        },
        style: {
          background: "var(--color-primary-bg)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text)",
        },
      }}
    />
  );
};
