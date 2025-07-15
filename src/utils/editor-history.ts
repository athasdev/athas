// Editor history management for undo/redo functionality

export interface HistoryEntry {
  text: string;
  cursorPosition: number;
  timestamp: number;
}

export class EditorHistory {
  private history: HistoryEntry[] = [];
  private currentIndex: number = -1;
  private maxHistorySize: number = 100;

  addEntry(text: string, cursorPosition: number): void {
    // Remove any entries after current index (when we undo then make a new change)
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }

    // Add new entry
    this.history.push({
      text,
      cursorPosition,
      timestamp: Date.now(),
    });

    // Maintain max history size
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    } else {
      this.currentIndex++;
    }
  }

  undo(): HistoryEntry | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.history[this.currentIndex];
    }
    return null;
  }

  redo(): HistoryEntry | null {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      return this.history[this.currentIndex];
    }
    return null;
  }

  getCurrentEntry(): HistoryEntry | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.history.length) {
      return this.history[this.currentIndex];
    }
    return null;
  }

  clear(): void {
    this.history = [];
    this.currentIndex = -1;
  }

  // Debounce helper for grouping rapid changes
  private debounceTimer: NodeJS.Timeout | null = null;

  addEntryDebounced(text: string, cursorPosition: number, delay: number = 500): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.addEntry(text, cursorPosition);
      this.debounceTimer = null;
    }, delay);
  }
}
