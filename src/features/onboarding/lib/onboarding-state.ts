import { getVersion } from "@tauri-apps/api/app";
import { getSettingsStore } from "@/features/settings/lib/settings-persistence";

const ONBOARDING_STATE_KEY = "product_onboarding_state_v1";
export type OnboardingMode = "first-run" | "updated" | "preview";

export interface OnboardingContext {
  mode: OnboardingMode;
  currentVersion: string;
  previousVersion?: string;
}

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

export async function resolveOnboardingContext(): Promise<OnboardingContext | null> {
  const currentVersion = await getVersion();

  const persistedState = await readPersistedOnboardingState();

  if (!persistedState.lastSeenVersion) {
    return {
      mode: "first-run",
      currentVersion,
    };
  }

  if (persistedState.lastSeenVersion !== currentVersion) {
    return {
      mode: "updated",
      currentVersion,
      previousVersion: persistedState.lastSeenVersion,
    };
  }

  return null;
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
