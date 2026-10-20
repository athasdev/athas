import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import type { ModalSlice } from "./ui-state/modal-slice";
import { createModalSlice } from "./ui-state/modal-slice";
import type { PanelSlice } from "./ui-state/panel-slice";
import { createPanelSlice } from "./ui-state/panel-slice";
import type { TerminalSlice } from "./ui-state/terminal-slice";
import { createTerminalSlice } from "./ui-state/terminal-slice";

type UIState = ModalSlice & PanelSlice & TerminalSlice;

const createUIStateStore = () =>
  createStore<UIState>()((...a) => ({
    ...createModalSlice(...a),
    ...createPanelSlice(...a),
    ...createTerminalSlice(...a),
  }));

export const useUIState = createWorkspaceScopedStore("window-ui", createUIStateStore);
