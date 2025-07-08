import { invoke } from "@tauri-apps/api/core";
import { CompletionItem, Diagnostic, Hover } from "vscode-languageserver-protocol";

import { CompletionResponse, LSPClientEvents, LSPConfig } from "./types";

export class LSPClient {
  private processId: number | null = null;
  private documentVersion = new Map<string, number>();
  private isInitialized = false;

  constructor(
    private language: string,
    private config: LSPConfig,
    private events: LSPClientEvents = {},
  ) {}

  async initialize(workspaceRoot: string): Promise<void> {
    try {
      this.processId = await invoke("start_lsp_server", {
        request: {
          language: this.language,
          command: this.config.command,
          args: this.config.args,
          working_dir: workspaceRoot,
          initialization_options: this.config.initializationOptions || null,
        },
      });

      this.isInitialized = true;
      this.events.onInitialized?.();

      console.log(`✅ ${this.language} LSP server started (PID: ${this.processId})`);
    } catch (error) {
      const message = `Failed to start ${this.language} LSP server: ${error}`;
      console.error(message);
      this.events.onError?.(new Error(message));
      throw error;
    }
  }

  async didOpenTextDocument(uri: string, content: string): Promise<void> {
    if (!this.isInitialized) return;

    this.documentVersion.set(uri, 1);

    try {
      await invoke("lsp_did_open", {
        language: this.language,
        uri,
        content,
        version: 1,
      });
    } catch (error) {
      console.error(`Error in didOpenTextDocument for ${this.language}:`, error);
    }
  }

  async didChangeTextDocument(uri: string, content: string): Promise<void> {
    if (!this.isInitialized) return;

    const version = (this.documentVersion.get(uri) || 0) + 1;
    this.documentVersion.set(uri, version);

    try {
      await invoke("lsp_did_change", {
        language: this.language,
        uri,
        content,
        version,
      });
    } catch (error) {
      console.error(`Error in didChangeTextDocument for ${this.language}:`, error);
    }
  }

  async didCloseTextDocument(uri: string): Promise<void> {
    if (!this.isInitialized) return;

    this.documentVersion.delete(uri);

    try {
      await invoke("lsp_did_close", {
        language: this.language,
        uri,
      });
    } catch (error) {
      console.error(`Error in didCloseTextDocument for ${this.language}:`, error);
    }
  }

  async completion(uri: string, line: number, character: number): Promise<CompletionItem[]> {
    if (!this.isInitialized) return [];

    try {
      const response: CompletionResponse = await invoke("lsp_completion", {
        language: this.language,
        uri,
        line,
        character,
      });

      return response.items || [];
    } catch (error) {
      console.error(`Completion request failed for ${this.language}:`, error);
      return [];
    }
  }

  async hover(uri: string, line: number, character: number): Promise<Hover | null> {
    if (!this.isInitialized) return null;

    try {
      return await invoke("lsp_hover", {
        language: this.language,
        uri,
        line,
        character,
      });
    } catch (error) {
      console.error(`Hover request failed for ${this.language}:`, error);
      return null;
    }
  }

  onDiagnostics(callback: (uri: string, diagnostics: Diagnostic[]) => void): void {
    this.events.onDiagnostics = callback;
  }

  async dispose(): Promise<void> {
    if (this.processId) {
      try {
        await invoke("stop_lsp_server", {
          language: this.language,
        });
        console.log(`🛑 ${this.language} LSP server stopped`);
      } catch (error) {
        console.error(`Error stopping ${this.language} LSP server:`, error);
      }

      this.processId = null;
    }

    this.isInitialized = false;
    this.documentVersion.clear();
  }

  get ready(): boolean {
    return this.isInitialized && this.processId !== null;
  }
}
