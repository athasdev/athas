import type { ComponentType } from "react";
import type { PaneContent, PaneContentType } from "@/features/panes/types/pane-content.types";

/**
 * What features show on the tabs of their buffers, contributed by the feature that owns the buffer
 * type. Features register from their registration module, which the workbench runs once before
 * it renders (`bootstrap/services/register-workbench-contributions.ts`).
 */

type TabBuffer<T extends PaneContentType> = Extract<PaneContent, { type: T }>;

export interface TabDecoration<T extends PaneContentType> {
  /** Replaces the default icon of the tab. */
  icon?: ComponentType<{ buffer: TabBuffer<T> }>;
  /** Shown after the tab's label and its unsaved-changes dot, for state that needs the user. */
  indicator?: ComponentType<{ buffer: TabBuffer<T> }>;
}

type AnyTabDecoration = TabDecoration<PaneContentType>;

const tabDecorations = new Map<PaneContentType, AnyTabDecoration>();

export function registerTabDecoration<T extends PaneContentType>(
  type: T,
  decoration: TabDecoration<T>,
) {
  tabDecorations.set(type, decoration as unknown as AnyTabDecoration);
}

export function getTabDecoration<T extends PaneContentType>(type: T): TabDecoration<T> | undefined {
  return tabDecorations.get(type) as TabDecoration<T> | undefined;
}
