import { create } from "zustand";
import { CONTEXT_CATEGORIES, getCategoryById, getCategoryByShortcut } from "./categories";
import { DocsProvider } from "./providers/docs-provider";
import { FilesProvider } from "./providers/files-provider";
import { GitProvider } from "./providers/git-provider";
import { RulesProvider } from "./providers/rules-provider";
import { WebProvider } from "./providers/web-provider";
import type { ContextSelectorStore, FileEntry } from "./types";

interface ContextSelectorStoreImpl extends ContextSelectorStore {
  // Internal state
  filesProvider: FilesProvider;
  docsProvider: DocsProvider;
  rulesProvider: RulesProvider;
  webProvider: WebProvider;
  gitProvider: GitProvider;

  // Internal methods
  setFiles: (files: FileEntry[]) => void;
  setRootPath: (path: string) => void;
  resetSelection: () => void;
  addWebUrl: (url: string) => void;
}

export const useContextSelectorStore = create<ContextSelectorStoreImpl>((set, get) => ({
  // State
  contextState: {
    isOpen: false,
    currentView: "categories",
    selectedCategory: null,
    selectedIndex: 0,
    searchQuery: "",
    position: { top: 0, left: 0 },
  },

  // Providers
  filesProvider: new FilesProvider(),
  docsProvider: new DocsProvider(),
  rulesProvider: new RulesProvider(),
  webProvider: new WebProvider(),
  gitProvider: new GitProvider(),

  // Actions
  showContextSelector: position => {
    set(state => ({
      contextState: {
        ...state.contextState,
        isOpen: true,
        currentView: "categories",
        selectedCategory: null,
        selectedIndex: 0,
        searchQuery: "",
        position,
      },
    }));
  },

  hideContextSelector: () => {
    set(state => ({
      contextState: {
        ...state.contextState,
        isOpen: false,
      },
    }));
  },

  selectCategory: categoryId => {
    set(state => ({
      contextState: {
        ...state.contextState,
        currentView: "items",
        selectedCategory: categoryId,
        selectedIndex: 0,
        searchQuery: "",
      },
    }));
  },

  goBackToCategories: () => {
    set(state => ({
      contextState: {
        ...state.contextState,
        currentView: "categories",
        selectedCategory: null,
        selectedIndex: 0,
        searchQuery: "",
      },
    }));
  },

  setSearchQuery: query => {
    set(state => ({
      contextState: {
        ...state.contextState,
        searchQuery: query,
        selectedIndex: 0,
      },
    }));
  },

  selectNext: () => {
    const { contextState } = get();
    const items =
      contextState.currentView === "categories" ? CONTEXT_CATEGORIES : get().getCurrentItems();

    if (items.length > 0) {
      set(state => ({
        contextState: {
          ...state.contextState,
          selectedIndex: Math.min(state.contextState.selectedIndex + 1, items.length - 1),
        },
      }));
    }
  },

  selectPrevious: () => {
    set(state => ({
      contextState: {
        ...state.contextState,
        selectedIndex: Math.max(state.contextState.selectedIndex - 1, 0),
      },
    }));
  },

  getCurrentItems: () => {
    const { contextState, filesProvider, docsProvider, rulesProvider, webProvider, gitProvider } =
      get();

    if (contextState.currentView === "categories") {
      return [];
    }

    const { selectedCategory, searchQuery } = contextState;

    switch (selectedCategory) {
      case "files":
        return searchQuery ? filesProvider.search(searchQuery) : filesProvider.getAll();
      case "docs":
        return searchQuery ? docsProvider.search(searchQuery) : docsProvider.getAll();
      case "rules":
        return searchQuery ? rulesProvider.search(searchQuery) : rulesProvider.getAll();
      case "web":
        return searchQuery ? webProvider.search(searchQuery) : webProvider.getAll();
      case "git":
        return searchQuery ? gitProvider.search(searchQuery) : gitProvider.getAll();
      case "terminals":
        // TODO: Implement terminals provider
        return [];
      case "errors":
        // TODO: Implement errors provider
        return [];
      default:
        return [];
    }
  },

  getCategories: () => {
    return CONTEXT_CATEGORIES;
  },

  // Internal methods
  setFiles: files => {
    const { filesProvider, docsProvider, rulesProvider } = get();
    filesProvider.setFiles(files);
    docsProvider.setFiles(files);
    rulesProvider.setFiles(files);
  },

  setRootPath: path => {
    const { gitProvider } = get();
    gitProvider.setRootPath(path);
  },

  addWebUrl: url => {
    const { webProvider } = get();
    webProvider.addUrl(url);
  },

  resetSelection: () => {
    set(state => ({
      contextState: {
        ...state.contextState,
        selectedIndex: 0,
      },
    }));
  },
}));

// Helper functions for external use
export const getCategoryFromShortcut = (shortcut: string) => {
  return getCategoryByShortcut(shortcut);
};

export const getCategoryFromId = (id: string) => {
  return getCategoryById(id);
};
