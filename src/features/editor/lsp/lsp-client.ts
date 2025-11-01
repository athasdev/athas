import { invoke } from "@tauri-apps/api/core";
import type { CompletionItem, Hover } from "vscode-languageserver-protocol";

export interface LspError {
  message: string;
}

export class LspClient {
  private static instance: LspClient | null = null;
  private activeWorkspaces = new Set<string>();

  static getInstance(): LspClient {
    if (!LspClient.instance) {
      LspClient.instance = new LspClient();
    }
    return LspClient.instance;
  }

  async start(workspacePath: string): Promise<void> {
    if (this.activeWorkspaces.has(workspacePath)) {
      console.log("LSP already started for workspace:", workspacePath);
      return;
    }

    try {
      console.log("Starting LSP with workspace:", workspacePath);
      await invoke<void>("lsp_start", { workspacePath });
      this.activeWorkspaces.add(workspacePath);
      console.log("LSP started successfully for workspace:", workspacePath);
    } catch (error) {
      console.error("Failed to start LSP:", error);
      throw error;
    }
  }

  async stop(workspacePath: string): Promise<void> {
    if (!this.activeWorkspaces.has(workspacePath)) {
      console.log("No LSP running for workspace:", workspacePath);
      return;
    }

    try {
      console.log("Stopping LSP for workspace:", workspacePath);
      await invoke<void>("lsp_stop", { workspacePath });
      this.activeWorkspaces.delete(workspacePath);
      console.log("LSP stopped successfully for workspace:", workspacePath);
    } catch (error) {
      console.error("Failed to stop LSP:", error);
      throw error;
    }
  }

  async stopAll(): Promise<void> {
    const workspaces = Array.from(this.activeWorkspaces);
    await Promise.all(workspaces.map((ws) => this.stop(ws)));
  }

  async getCompletions(
    filePath: string,
    line: number,
    character: number,
  ): Promise<CompletionItem[]> {
    try {
      console.log(`Getting completions for ${filePath}:${line}:${character}`);
      console.log(`Active workspaces: ${Array.from(this.activeWorkspaces).join(", ")}`);
      const completions = await invoke<CompletionItem[]>("lsp_get_completions", {
        filePath,
        line,
        character,
      });
      if (completions.length === 0) {
        console.warn("LSP returned 0 completions - checking LSP status");
      } else {
        console.log(`Got ${completions.length} completions from LSP server`);
      }
      return completions;
    } catch (error) {
      console.error("LSP completion error:", error);
      return [];
    }
  }

  async getHover(filePath: string, line: number, character: number): Promise<Hover | null> {
    try {
      return await invoke<Hover | null>("lsp_get_hover", {
        filePath,
        line,
        character,
      });
    } catch (error) {
      console.error("LSP hover error:", error);
      return null;
    }
  }

  async notifyDocumentOpen(filePath: string, content: string): Promise<void> {
    try {
      console.log(`Opening document: ${filePath}`);
      await invoke<void>("lsp_document_open", { filePath, content });
    } catch (error) {
      console.error("LSP document open error:", error);
    }
  }

  async notifyDocumentChange(filePath: string, content: string, version: number): Promise<void> {
    try {
      await invoke<void>("lsp_document_change", {
        filePath,
        content,
        version,
      });
    } catch (error) {
      console.error("LSP document change error:", error);
    }
  }

  async notifyDocumentClose(filePath: string): Promise<void> {
    try {
      await invoke<void>("lsp_document_close", { filePath });
    } catch (error) {
      console.error("LSP document close error:", error);
    }
  }

  async isLanguageSupported(filePath: string): Promise<boolean> {
    try {
      return await invoke<boolean>("lsp_is_language_supported", { filePath });
    } catch (error) {
      console.error("LSP language support check error:", error);
      return false;
    }
  }

  getActiveWorkspaces(): string[] {
    return Array.from(this.activeWorkspaces);
  }

  isWorkspaceActive(workspacePath: string): boolean {
    return this.activeWorkspaces.has(workspacePath);
  }
}
