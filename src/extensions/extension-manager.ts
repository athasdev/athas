import type { Decoration } from "../types/editor-types";
import type {
  Command,
  EditorAPI,
  EditorExtension,
  Extension,
  ExtensionContext,
} from "./extension-types";

class ExtensionManager {
  private extensions: Map<string, EditorExtension> = new Map();
  private newExtensions: Map<string, Extension> = new Map(); // New extension system
  private contexts: Map<string, ExtensionContext> = new Map();
  private commands: Map<string, Command> = new Map();
  private registeredCommands: Map<string, (...args: any[]) => any> = new Map(); // New command system
  private keybindings: Map<string, string> = new Map();
  private decorationProviders: Map<string, () => Decoration[]> = new Map();
  private editor: EditorAPI | null = null;
  private initialized = false;

  setEditor(editor: EditorAPI) {
    this.editor = editor;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }
    // Clear any existing state
    this.extensions.clear();
    this.contexts.clear();
    this.commands.clear();
    this.keybindings.clear();
    this.decorationProviders.clear();
    this.initialized = true;
  }

  async loadExtension(extension: EditorExtension): Promise<void> {
    if (!this.editor) {
      throw new Error("Editor API not initialized");
    }

    const extensionId = this.generateExtensionId(extension.name);

    if (this.extensions.has(extensionId)) {
      throw new Error(`Extension ${extension.name} is already loaded`);
    }

    // Create extension context
    const context: ExtensionContext = {
      editor: this.editor,
      extensionId,
      storage: this.createExtensionStorage(extensionId),
      registerCommand: (id: string, handler: (...args: any[]) => any) => {
        // Legacy support - convert to old command format
        this.commands.set(id, {
          id,
          name: id,
          execute: handler,
        });
      },
      registerLanguage: (language) => {
        // Language registration would be implemented here
        console.log("Registering language:", language);
      },
    };

    // Store extension and context
    this.extensions.set(extensionId, extension);
    this.contexts.set(extensionId, context);

    // Register commands
    if (extension.commands) {
      for (const command of extension.commands) {
        this.registerCommand(command);
      }
    }

    // Register keybindings
    if (extension.keybindings) {
      for (const [key, commandId] of Object.entries(extension.keybindings)) {
        this.registerKeybinding(key, commandId);
      }
    }

    // Register decoration provider
    if (extension.decorations) {
      this.decorationProviders.set(extensionId, extension.decorations);
    }

    // Initialize extension
    if (extension.initialize) {
      await extension.initialize(this.editor);
    }

    // Set up event handlers
    this.setupEventHandlers(extension);
  }

  unloadExtension(extensionName: string): void {
    const extensionId = this.generateExtensionId(extensionName);
    const extension = this.extensions.get(extensionId);

    if (!extension) {
      throw new Error(`Extension ${extensionName} is not loaded`);
    }

    // Dispose extension
    if (extension.dispose) {
      extension.dispose();
    }

    // Unregister commands
    if (extension.commands) {
      for (const command of extension.commands) {
        this.commands.delete(command.id);
      }
    }

    // Unregister keybindings
    if (extension.keybindings) {
      for (const key of Object.keys(extension.keybindings)) {
        this.keybindings.delete(key);
      }
    }

    // Unregister decoration provider
    this.decorationProviders.delete(extensionId);

    // Remove event handlers
    this.removeEventHandlers(extensionId);

    // Clear storage
    const context = this.contexts.get(extensionId);
    if (context) {
      context.storage.clear();
    }

    // Remove extension and context
    this.extensions.delete(extensionId);
    this.contexts.delete(extensionId);
  }

  getCommand(commandId: string): Command | undefined {
    return this.commands.get(commandId);
  }

  getCommandForKeybinding(key: string): Command | undefined {
    const commandId = this.keybindings.get(key);
    if (!commandId) return undefined;
    return this.commands.get(commandId);
  }

  getAllCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  getAllKeybindings(): Map<string, string> {
    return this.keybindings;
  }

  getAllDecorations(): Decoration[] {
    const decorations: Decoration[] = [];

    for (const provider of this.decorationProviders.values()) {
      decorations.push(...provider());
    }

    return decorations;
  }

  getLoadedExtensions(): EditorExtension[] {
    return Array.from(this.extensions.values());
  }

  isExtensionLoaded(extensionName: string): boolean {
    const extensionId = this.generateExtensionId(extensionName);
    return this.extensions.has(extensionId) || this.newExtensions.has(extensionId);
  }

  // New extension system methods
  async loadNewExtension(extension: Extension): Promise<void> {
    if (!this.editor) {
      throw new Error("Editor API not initialized");
    }

    if (this.newExtensions.has(extension.id)) {
      throw new Error(`Extension ${extension.id} is already loaded`);
    }

    // Create enhanced extension context
    const context: ExtensionContext = {
      editor: this.editor,
      extensionId: extension.id,
      storage: this.createExtensionStorage(extension.id),
      registerCommand: (id: string, handler: (...args: any[]) => any) => {
        this.registeredCommands.set(id, handler);
      },
      registerLanguage: (language) => {
        // Language registration would be implemented here
        console.log("Registering language:", language);
      },
    };

    // Store extension and context
    this.newExtensions.set(extension.id, extension);
    this.contexts.set(extension.id, context);

    try {
      // Activate extension
      await extension.activate(context);
      console.log(`Extension ${extension.displayName} loaded successfully`);
    } catch (error) {
      // Cleanup on failure
      this.newExtensions.delete(extension.id);
      this.contexts.delete(extension.id);
      throw new Error(`Failed to activate extension ${extension.displayName}: ${error}`);
    }
  }

  async unloadNewExtension(extensionId: string): Promise<void> {
    const extension = this.newExtensions.get(extensionId);
    if (!extension) {
      throw new Error(`Extension ${extensionId} not found`);
    }

    try {
      // Deactivate extension
      await extension.deactivate();
    } catch (error) {
      console.error(`Error deactivating extension ${extensionId}:`, error);
    }

    // Cleanup commands
    if (extension.contributes?.commands) {
      for (const command of extension.contributes.commands) {
        this.registeredCommands.delete(command.id);
      }
    }

    // Remove extension and context
    this.newExtensions.delete(extensionId);
    this.contexts.delete(extensionId);
  }

  executeCommand(commandId: string, ...args: any[]): any {
    const handler = this.registeredCommands.get(commandId);
    if (handler) {
      return handler(...args);
    }

    // Fallback to old command system
    const command = this.commands.get(commandId);
    if (command) {
      return command.execute(args[0]);
    }

    throw new Error(`Command ${commandId} not found`);
  }

  getAllNewExtensions(): Extension[] {
    return Array.from(this.newExtensions.values());
  }

  getNewExtension(extensionId: string): Extension | undefined {
    return this.newExtensions.get(extensionId);
  }

  private generateExtensionId(name: string): string {
    return name.toLowerCase().replace(/\s+/g, "-");
  }

  private registerCommand(command: Command): void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command ${command.id} is already registered`);
    }
    this.commands.set(command.id, command);
  }

  private registerKeybinding(key: string, commandId: string): void {
    if (this.keybindings.has(key)) {
      console.warn(`Keybinding ${key} is already registered, overwriting`);
    }
    this.keybindings.set(key, commandId);
  }

  private createExtensionStorage(extensionId: string): ExtensionContext["storage"] {
    const storageKey = `extension-${extensionId}`;

    return {
      get: <T>(key: string): T | undefined => {
        try {
          const data = localStorage.getItem(`${storageKey}-${key}`);
          return data ? JSON.parse(data) : undefined;
        } catch {
          return undefined;
        }
      },
      set: <T>(key: string, value: T): void => {
        localStorage.setItem(`${storageKey}-${key}`, JSON.stringify(value));
      },
      delete: (key: string): void => {
        localStorage.removeItem(`${storageKey}-${key}`);
      },
      clear: (): void => {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith(`${storageKey}-`));
        keys.forEach((key) => localStorage.removeItem(key));
      },
    };
  }

  private setupEventHandlers(extension: EditorExtension): void {
    if (!this.editor) return;

    const handlers: Array<[string, () => void]> = [];

    if (extension.onContentChange) {
      const handler = (data: any) => {
        if (data && typeof data === "object" && "content" in data && "changes" in data) {
          extension.onContentChange!(data.content, data.changes, data.affectedLines);
        }
      };
      const unsubscribe = this.editor.on("contentChange", handler);
      handlers.push(["contentChange", unsubscribe]);
    }

    if (extension.onSelectionChange) {
      const handler = (data: any) => extension.onSelectionChange!(data);
      const unsubscribe = this.editor.on("selectionChange", handler);
      handlers.push(["selectionChange", unsubscribe]);
    }

    if (extension.onCursorChange) {
      const handler = (data: any) => extension.onCursorChange!(data);
      const unsubscribe = this.editor.on("cursorChange", handler);
      handlers.push(["cursorChange", unsubscribe]);
    }

    if (extension.onSettingsChange) {
      const handler = (data: any) => extension.onSettingsChange!(data);
      const unsubscribe = this.editor.on("settingsChange", handler);
      handlers.push(["settingsChange", unsubscribe]);
    }

    if (extension.onKeyDown) {
      const handler = (data: any) => extension.onKeyDown!(data);
      const unsubscribe = this.editor.on("keydown", handler);
      handlers.push(["keydown", unsubscribe]);
    }

    // Store handlers for cleanup
    (extension as any)._eventHandlers = handlers;
  }

  private removeEventHandlers(extensionId: string): void {
    const extension = this.extensions.get(extensionId);
    if (!extension) return;

    const handlers = (extension as any)._eventHandlers as Array<[string, () => void]>;
    if (handlers) {
      handlers.forEach(([_, unsubscribe]) => unsubscribe());
    }
  }
}

// Global extension manager instance
export const extensionManager = new ExtensionManager();
