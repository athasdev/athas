export interface Terminal {
  id: string;
  name: string;
  currentDirectory: string;
  isActive: boolean;
  isPinned?: boolean;
  shell?: string;
  createdAt: Date;
  lastActivity?: Date;
  connectionId?: string;
  selection?: string;
  title?: string;
  ref?: any;
  splitMode?: boolean;
  splitWithId?: string; // ID of the terminal to split with
}

export interface Shell {
  id: string;
  name: string;
  exec_unix?: string; // search for common paths like /bin/shell_name
  exec_win?: string; // search for paths in %PATH% matching *.exe
}

export interface TerminalState {
  terminals: Terminal[];
  activeTerminalId: string | null;
}

export type TerminalAction =
  | {
      type: "CREATE_TERMINAL";
      payload: {
        name: string;
        currentDirectory: string;
        shell?: string;
        id?: string;
      };
    }
  | { type: "CLOSE_TERMINAL"; payload: { id: string } }
  | { type: "SET_ACTIVE_TERMINAL"; payload: { id: string } }
  | { type: "UPDATE_TERMINAL_NAME"; payload: { id: string; name: string } }
  | {
      type: "UPDATE_TERMINAL_DIRECTORY";
      payload: { id: string; currentDirectory: string };
    }
  | { type: "UPDATE_TERMINAL_ACTIVITY"; payload: { id: string } }
  | { type: "PIN_TERMINAL"; payload: { id: string; isPinned: boolean } }
  | {
      type: "REORDER_TERMINALS";
      payload: { fromIndex: number; toIndex: number };
    }
  | {
      type: "SET_TERMINAL_SPLIT_MODE";
      payload: { id: string; splitMode: boolean; splitWithId?: string };
    };
