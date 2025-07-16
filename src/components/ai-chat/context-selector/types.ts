import type React from "react";

export interface FileEntry {
  path: string;
  name: string;
  isDir: boolean;
}

export interface ContextCategory {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  shortcut?: string;
}

export interface ContextItem {
  id: string;
  name: string;
  description?: string;
  path?: string;
  type: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  metadata?: Record<string, any>;
}

export interface ContextSelectorState {
  isOpen: boolean;
  currentView: "categories" | "items";
  selectedCategory: string | null;
  selectedIndex: number;
  searchQuery: string;
  position: { top: number; left: number };
}

export interface ContextSelectorStore {
  // State
  contextState: ContextSelectorState;

  // Actions
  showContextSelector: (position: { top: number; left: number }) => void;
  hideContextSelector: () => void;
  selectCategory: (categoryId: string) => void;
  goBackToCategories: () => void;
  setSearchQuery: (query: string) => void;
  selectNext: () => void;
  selectPrevious: () => void;
  getCurrentItems: () => ContextItem[];
  getCategories: () => ContextCategory[];
}
