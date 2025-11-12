import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  CompletionItem,
  Hover,
  PublishDiagnosticsParams,
} from "vscode-languageserver-protocol";
import {
  convertLSPDiagnostic,
  useDiagnosticsStore,
} from "@/features/diagnostics/diagnostics-store";
import { logger } from "../utils/logger";

export interface LspError {
  message: string;
}

export class LspClient {
  private static instance: LspClient | null = null;
  private activeLanguageServers = new Set<string>(); // workspace:language format

  private constructor() {
    this.setupDiagnosticsListener();
  }

  static getInstance(): LspClient {
    if (!LspClient.instance) {
      LspClient.instance = new LspClient();
    }
    return LspClient.instance;
  }

  private async setupDiagnosticsListener() {
    try {
      await listen<PublishDiagnosticsParams>("lsp://diagnostics", (event) => {
        const { uri, diagnostics } = event.payload;
        logger.debug("LSPClient", `Received diagnostics for ${uri}:`, diagnostics);

        // Convert URI to file path
        const filePath = uri.replace("file://", "");

        // Convert LSP diagnostics to our internal format
        const convertedDiagnostics = diagnostics.map((d) => convertLSPDiagnostic(d));

        // Update diagnostics store
        const { setDiagnostics } = useDiagnosticsStore.getState().actions;
        setDiagnostics(filePath, convertedDiagnostics);

        logger.info(
          "LSPClient",
          `Updated diagnostics for ${filePath}: ${convertedDiagnostics.length} items`,
        );
      });
    } catch (error) {
      logger.error("LSPClient", "Failed to setup diagnostics listener:", error);
    }
  }

  async start(workspacePath: string, filePath?: string): Promise<void> {
    try {
      logger.debug("LSPClient", "Starting LSP with workspace:", workspacePath);

      // Get LSP server info from extension registry if file path is provided
      let serverPath: string | undefined;
      let serverArgs: string[] | undefined;
      let languageId: string | undefined;

      if (filePath) {
        const { extensionRegistry } = await import("@/extensions/registry/extension-registry");

        serverPath = extensionRegistry.getLspServerPath(filePath) || undefined;
        serverArgs = extensionRegistry.getLspServerArgs(filePath);
        languageId = extensionRegistry.getLanguageId(filePath) || undefined;

        logger.info("LSPClient", `Using LSP server: ${serverPath} for language: ${languageId}`);

        // Check if this language server is already running for this workspace
        if (serverPath && languageId) {
          const serverKey = `${workspacePath}:${languageId}`;
          if (this.activeLanguageServers.has(serverKey)) {
            logger.debug("LSPClient", `LSP for ${languageId} already running in workspace`);
            return;
          }
        }
      }

      logger.info("LSPClient", `Invoking lsp_start with:`, {
        workspacePath,
        serverPath,
        serverArgs,
      });

      await invoke<void>("lsp_start", {
        workspacePath,
        serverPath,
        serverArgs,
      });

      // Track this language server
      if (languageId) {
        const serverKey = `${workspacePath}:${languageId}`;
        this.activeLanguageServers.add(serverKey);
      }

      logger.debug("LSPClient", "LSP started successfully for workspace:", workspacePath);
    } catch (error) {
      logger.error("LSPClient", "Failed to start LSP:", error);
      throw error;
    }
  }

  async stop(workspacePath: string): Promise<void> {
    try {
      logger.debug("LSPClient", "Stopping LSP for workspace:", workspacePath);
      await invoke<void>("lsp_stop", { workspacePath });

      // Remove all language servers for this workspace
      const serversToRemove = Array.from(this.activeLanguageServers).filter((key) =>
        key.startsWith(`${workspacePath}:`),
      );
      for (const server of serversToRemove) {
        this.activeLanguageServers.delete(server);
      }

      logger.debug("LSPClient", "LSP stopped successfully for workspace:", workspacePath);
    } catch (error) {
      logger.error("LSPClient", "Failed to stop LSP:", error);
      throw error;
    }
  }

  async stopAll(): Promise<void> {
    // Get unique workspace paths from all active language servers
    const workspaces = new Set<string>();
    for (const key of this.activeLanguageServers) {
      const workspace = key.split(":")[0];
      workspaces.add(workspace);
    }
    await Promise.all(Array.from(workspaces).map((ws) => this.stop(ws)));
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
        `Active language servers: ${Array.from(this.activeLanguageServers).join(", ")}`,
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
    // Get unique workspace paths from all active language servers
    const workspaces = new Set<string>();
    for (const key of this.activeLanguageServers) {
      const workspace = key.split(":")[0];
      workspaces.add(workspace);
    }
    return Array.from(workspaces);
  }

  isWorkspaceActive(workspacePath: string): boolean {
    // Check if any language server is running for this workspace
    for (const key of this.activeLanguageServers) {
      if (key.startsWith(`${workspacePath}:`)) {
        return true;
      }
    }
    return false;
  }
}
