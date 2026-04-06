import { getVersion } from "@tauri-apps/api/app";
import { create } from "zustand";
import {
  markOnboardingCompleted,
  markOnboardingSeen,
  resolveOnboardingContext,
  type OnboardingContext,
} from "@/features/onboarding/lib/onboarding-state";

interface OnboardingStoreState {
  initialized: boolean;
  isOpen: boolean;
  context: OnboardingContext | null;
  initialize: () => Promise<void>;
  dismiss: () => Promise<void>;
  complete: () => Promise<void>;
  openPreview: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingStoreState>()((set, get) => ({
  initialized: false,
  isOpen: false,
  context: null,

  initialize: async () => {
    if (get().initialized) {
      return;
    }

    const context = await resolveOnboardingContext();

    set({
      initialized: true,
      isOpen: context !== null,
      context,
    });
  },

  dismiss: async () => {
    const context = get().context;
    if (context && context.mode !== "preview") {
      await markOnboardingSeen(context.currentVersion);
    }

    set({
      isOpen: false,
      context: null,
    });
  },

  complete: async () => {
    const context = get().context;
    if (context && context.mode !== "preview") {
      await markOnboardingCompleted(context.currentVersion);
    }

    set({
      isOpen: false,
      context: null,
    });
  },

  openPreview: async () => {
    const currentVersion = await getVersion();
    set({
      initialized: true,
      isOpen: true,
      context: {
        mode: "preview",
        currentVersion,
      },
    });
  },
}));
