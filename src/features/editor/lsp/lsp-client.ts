import { invoke } from "@tauri-apps/api/core";
import type { CompletionItem, Hover } from "vscode-languageserver-protocol";
import { logger } from "../utils/logger";

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
      logger.debug("LSPClient", "LSP already started for workspace:", workspacePath);
      return;
    }

    try {
      logger.debug("LSPClient", "Starting LSP with workspace:", workspacePath);
      await invoke<void>("lsp_start", { workspacePath });
      this.activeWorkspaces.add(workspacePath);
      logger.debug("LSPClient", "LSP started successfully for workspace:", workspacePath);
    } catch (error) {
      logger.error("LSPClient", "Failed to start LSP:", error);
      throw error;
    }
  }

  async stop(workspacePath: string): Promise<void> {
    if (!this.activeWorkspaces.has(workspacePath)) {
      logger.debug("LSPClient", "No LSP running for workspace:", workspacePath);
      return;
    }

    try {
      logger.debug("LSPClient", "Stopping LSP for workspace:", workspacePath);
      await invoke<void>("lsp_stop", { workspacePath });
      this.activeWorkspaces.delete(workspacePath);
      logger.debug("LSPClient", "LSP stopped successfully for workspace:", workspacePath);
    } catch (error) {
      logger.error("LSPClient", "Failed to stop LSP:", error);
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
      logger.debug("LSPClient", `Getting completions for ${filePath}:${line}:${character}`);
      logger.debug(
        "LSPClient",
        `Active workspaces: ${Array.from(this.activeWorkspaces).join(", ")}`,
      );
      const completions = await invoke<CompletionItem[]>("lsp_get_completions", {
        filePath,
        line,
        character,
      });
      if (completions.length === 0) {
        logger.warn("LSPClient", "LSP returned 0 completions - checking LSP status");
      } else {
        logger.debug("LSPClient", `Got ${completions.length} completions from LSP server`);
      }
      return completions;
    } catch (error) {
      logger.error("LSPClient", "LSP completion error:", error);
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
      logger.error("LSPClient", "LSP hover error:", error);
      return null;
    }
  }

  async notifyDocumentOpen(filePath: string, content: string): Promise<void> {
    try {
      logger.debug("LSPClient", `Opening document: ${filePath}`);
      await invoke<void>("lsp_document_open", { filePath, content });
    } catch (error) {
      logger.error("LSPClient", "LSP document open error:", error);
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
      logger.error("LSPClient", "LSP document change error:", error);
    }
  }

  async notifyDocumentClose(filePath: string): Promise<void> {
    try {
      await invoke<void>("lsp_document_close", { filePath });
    } catch (error) {
      logger.error("LSPClient", "LSP document close error:", error);
    }
  }

  async isLanguageSupported(filePath: string): Promise<boolean> {
    try {
      return await invoke<boolean>("lsp_is_language_supported", { filePath });
    } catch (error) {
      logger.error("LSPClient", "LSP language support check error:", error);
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
