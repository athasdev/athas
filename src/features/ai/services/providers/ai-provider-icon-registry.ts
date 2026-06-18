import { useSyncExternalStore, type ComponentType, type SVGProps } from "react";

export type AIProviderIconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const icons = new Map<string, AIProviderIconComponent>();
const providerIdsByExtension = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
let snapshot: Map<string, AIProviderIconComponent> | null = null;

function emitChange() {
  snapshot = null;
  listeners.forEach((listener) => listener());
}

export function subscribeToAIProviderIcons(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerAIProviderIcon(params: {
  extensionId: string;
  providerId: string;
  icon: AIProviderIconComponent;
}): void {
  icons.set(params.providerId, params.icon);

  const providerIds = providerIdsByExtension.get(params.extensionId) ?? new Set<string>();
  providerIds.add(params.providerId);
  providerIdsByExtension.set(params.extensionId, providerIds);

  emitChange();
}

export function unregisterAIProviderIconsByExtension(extensionId: string): void {
  const providerIds = providerIdsByExtension.get(extensionId);
  if (!providerIds) return;

  providerIds.forEach((providerId) => icons.delete(providerId));
  providerIdsByExtension.delete(extensionId);
  emitChange();
}

export function getAIProviderIcons(): Map<string, AIProviderIconComponent> {
  if (!snapshot) {
    snapshot = new Map(icons);
  }

  return snapshot;
}

export function useAIProviderIcon(providerId: string): AIProviderIconComponent | undefined {
  return useSyncExternalStore(
    subscribeToAIProviderIcons,
    getAIProviderIcons,
    getAIProviderIcons,
  ).get(providerId);
}
