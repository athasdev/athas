import { useSyncExternalStore } from "react";
import type { CommandPaletteViewId } from "@/features/command-palette/types/view.types";

export interface AIProviderSettingsAction {
  id: string;
  extensionId: string;
  providerId: string;
  label: string;
  buttonLabel: string;
  commandPaletteViewId: CommandPaletteViewId;
  icon?: "palette" | "sparkles";
  getDescription?: () => string;
}

const actions = new Map<string, AIProviderSettingsAction>();
const actionIdsByExtension = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
let snapshot: AIProviderSettingsAction[] | null = null;

function emitChange() {
  snapshot = null;
  listeners.forEach((listener) => listener());
}

export function subscribeToAIProviderSettingsActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerAIProviderSettingsAction(action: AIProviderSettingsAction): void {
  actions.set(action.id, action);

  const extensionActionIds = actionIdsByExtension.get(action.extensionId) ?? new Set<string>();
  extensionActionIds.add(action.id);
  actionIdsByExtension.set(action.extensionId, extensionActionIds);

  emitChange();
}

export function unregisterAIProviderSettingsActionsByExtension(extensionId: string): void {
  const actionIds = actionIdsByExtension.get(extensionId);
  if (!actionIds) return;

  actionIds.forEach((actionId) => actions.delete(actionId));
  actionIdsByExtension.delete(extensionId);
  emitChange();
}

export function getAIProviderSettingsActions(providerId?: string): AIProviderSettingsAction[] {
  if (!snapshot) {
    snapshot = Array.from(actions.values());
  }

  if (!providerId) {
    return snapshot;
  }

  return snapshot.filter((action) => action.providerId === providerId);
}

export function useAIProviderSettingsActions(providerId?: string): AIProviderSettingsAction[] {
  const allActions = useSyncExternalStore(
    subscribeToAIProviderSettingsActions,
    getAIProviderSettingsActions,
    getAIProviderSettingsActions,
  );

  return providerId ? allActions.filter((action) => action.providerId === providerId) : allActions;
}
