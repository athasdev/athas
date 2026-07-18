import { create } from "zustand";
import type { NotificationEntry, NotificationType } from "../types/notifications.types";
import { createSelectors } from "@/utils/zustand-selectors";

const MAX_NOTIFICATIONS = 20;

interface NotificationsState {
  notifications: NotificationEntry[];
  actions: {
    record: (notification: {
      id: string;
      message: string;
      description?: string;
      type: NotificationType;
    }) => void;
    markAllRead: () => void;
    remove: (id: string) => void;
    clear: () => void;
  };
}

export const useNotificationsStore = createSelectors(
  create<NotificationsState>()((set) => ({
    notifications: [],
    actions: {
      record: (notification) =>
        set((state) => {
          const now = Date.now();
          const existing = state.notifications.find((item) => item.id === notification.id);
          const next: NotificationEntry = existing
            ? {
                ...existing,
                ...notification,
                updatedAt: now,
                read: false,
              }
            : {
                ...notification,
                createdAt: now,
                updatedAt: now,
                read: false,
              };

          return {
            notifications: [
              next,
              ...state.notifications.filter((item) => item.id !== notification.id),
            ].slice(0, MAX_NOTIFICATIONS),
          };
        }),
      markAllRead: () =>
        set((state) => ({
          notifications: state.notifications.map((item) => ({ ...item, read: true })),
        })),
      remove: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((item) => item.id !== id),
        })),
      clear: () => set({ notifications: [] }),
    },
  })),
);
