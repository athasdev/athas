import { getVersion } from "@tauri-apps/api/app";
import { getSettingsStore } from "@/features/settings/services/settings-persistence";
import type { OnboardingContext, OnboardingMode } from "@/features/panes/types/pane-content.types";

const ONBOARDING_STATE_KEY = "product_onboarding_state_v1";

export type { OnboardingContext, OnboardingMode };

interface PersistedOnboardingState {
  lastSeenVersion?: string;
  completedVersion?: string;
}

async function readPersistedOnboardingState(): Promise<PersistedOnboardingState> {
  const store = await getSettingsStore();
  const state = await store.get<PersistedOnboardingState>(ONBOARDING_STATE_KEY);
  return state ?? {};
}

async function writePersistedOnboardingState(state: PersistedOnboardingState) {
  const store = await getSettingsStore();
  await store.set(ONBOARDING_STATE_KEY, state);
  await store.save();
}

export function resolveOnboardingContextFromState(
  currentVersion: string,
  persistedState: PersistedOnboardingState,
): OnboardingContext | null {
  if (!persistedState.lastSeenVersion) {
    return {
      mode: "first-run",
      currentVersion,
    };
  }

  return null;
}

export async function resolveOnboardingContext(): Promise<OnboardingContext | null> {
  const [currentVersion, persistedState] = await Promise.all([
    getVersion(),
    readPersistedOnboardingState(),
  ]);
  return resolveOnboardingContextFromState(currentVersion, persistedState);
}

export async function markOnboardingSeen(currentVersion: string) {
  const persistedState = await readPersistedOnboardingState();
  await writePersistedOnboardingState({
    ...persistedState,
    lastSeenVersion: currentVersion,
  });
}

export async function markOnboardingCompleted(currentVersion: string) {
  const persistedState = await readPersistedOnboardingState();
  await writePersistedOnboardingState({
    ...persistedState,
    lastSeenVersion: currentVersion,
    completedVersion: currentVersion,
  });
}
