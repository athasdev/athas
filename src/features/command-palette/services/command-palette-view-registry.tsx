import { useSyncExternalStore, type ReactNode } from "react";
import type { CommandPaletteViewId } from "@/features/command-palette/types/view.types";

export interface CommandPaletteViewRenderProps {
  isActive: boolean;
  onBack: () => void;
  onClose: () => void;
}

export interface RegisteredCommandPaletteView {
  id: CommandPaletteViewId;
  extensionId: string;
  render: (props: CommandPaletteViewRenderProps) => ReactNode;
}

const views = new Map<CommandPaletteViewId, RegisteredCommandPaletteView>();
const viewIdsByExtension = new Map<string, Set<CommandPaletteViewId>>();
const listeners = new Set<() => void>();
let snapshot: Map<CommandPaletteViewId, RegisteredCommandPaletteView> | null = null;

function emitChange() {
  snapshot = null;
  listeners.forEach((listener) => listener());
}

export function subscribeToCommandPaletteViews(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerCommandPaletteView(view: RegisteredCommandPaletteView): void {
  views.set(view.id, view);

  const extensionViewIds =
    viewIdsByExtension.get(view.extensionId) ?? new Set<CommandPaletteViewId>();
  extensionViewIds.add(view.id);
  viewIdsByExtension.set(view.extensionId, extensionViewIds);

  emitChange();
}

export function unregisterCommandPaletteViewsByExtension(extensionId: string): void {
  const viewIds = viewIdsByExtension.get(extensionId);
  if (!viewIds) return;

  viewIds.forEach((viewId) => views.delete(viewId));
  viewIdsByExtension.delete(extensionId);
  emitChange();
}

export function getCommandPaletteViews(): Map<CommandPaletteViewId, RegisteredCommandPaletteView> {
  if (!snapshot) {
    snapshot = new Map(views);
  }

  return snapshot;
}

export function getCommandPaletteView(
  viewId: CommandPaletteViewId,
): RegisteredCommandPaletteView | undefined {
  return getCommandPaletteViews().get(viewId);
}

export function useCommandPaletteViews(): Map<CommandPaletteViewId, RegisteredCommandPaletteView> {
  return useSyncExternalStore(
    subscribeToCommandPaletteViews,
    getCommandPaletteViews,
    getCommandPaletteViews,
  );
}
