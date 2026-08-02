export interface PastedImage {
  id: string;
  dataUrl: string;
  name: string;
  size: number;
}

export interface InlineDropdownPosition {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface MentionState {
  active: boolean;
  position: InlineDropdownPosition;
  search: string;
  startIndex: number;
  selectedIndex: number;
}

export interface SlashCommandState {
  active: boolean;
  position: InlineDropdownPosition;
  search: string;
  selectedIndex: number;
}
