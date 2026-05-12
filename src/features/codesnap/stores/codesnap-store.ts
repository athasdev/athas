import { create } from "zustand";
import type { CodesnapShutterAction } from "../types";

type TabUiState = {
  width: number;
  shutterAction: CodesnapShutterAction;
  exporting: boolean;
};

type CodesnapStore = {
  tabs: Record<string, TabUiState>;
  ensure: (tabId: string, initial: { width: number; shutterAction: CodesnapShutterAction }) => void;
  setWidth: (tabId: string, width: number) => void;
  setShutterAction: (tabId: string, action: CodesnapShutterAction) => void;
  setExporting: (tabId: string, exporting: boolean) => void;
  drop: (tabId: string) => void;
};

export const useCodesnapStore = create<CodesnapStore>((set) => ({
  tabs: {},
  ensure: (tabId, initial) =>
    set((s) =>
      s.tabs[tabId] ? s : { tabs: { ...s.tabs, [tabId]: { ...initial, exporting: false } } },
    ),
  setWidth: (tabId, width) =>
    set((s) => (s.tabs[tabId] ? { tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], width } } } : s)),
  setShutterAction: (tabId, shutterAction) =>
    set((s) =>
      s.tabs[tabId] ? { tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], shutterAction } } } : s,
    ),
  setExporting: (tabId, exporting) =>
    set((s) =>
      s.tabs[tabId] ? { tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], exporting } } } : s,
    ),
  drop: (tabId) =>
    set((s) => {
      const next = { ...s.tabs };
      delete next[tabId];
      return { tabs: next };
    }),
}));
