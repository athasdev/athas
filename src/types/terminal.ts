export interface Terminal {
  id: string;
  name: string;
  currentDirectory: string;
  isActive: boolean;
  isPinned?: boolean;
  shell?: string;
  createdAt: Date;
  lastActivity?: Date;
}

export interface TerminalState {
  terminals: Terminal[];
  activeTerminalId: string | null;
}

export type TerminalAction =
  | { type: "CREATE_TERMINAL"; payload: { name: string; currentDirectory: string; shell?: string } }
  | { type: "CLOSE_TERMINAL"; payload: { id: string } }
  | { type: "SET_ACTIVE_TERMINAL"; payload: { id: string } }
  | { type: "UPDATE_TERMINAL_NAME"; payload: { id: string; name: string } }
  | { type: "UPDATE_TERMINAL_DIRECTORY"; payload: { id: string; currentDirectory: string } }
  | { type: "UPDATE_TERMINAL_ACTIVITY"; payload: { id: string } }
  | { type: "PIN_TERMINAL"; payload: { id: string; isPinned: boolean } }
  | { type: "REORDER_TERMINALS"; payload: { fromIndex: number; toIndex: number } };
