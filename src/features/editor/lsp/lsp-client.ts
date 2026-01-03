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
} from "@/features/diagnostics/stores/diagnostics-store";
import { logger } from "../utils/logger";
import { useLspStore } from "./lsp-store";

export interface LspError {
  message: string;
}

export class LspClient {
  private static instance: LspClient | null = null;
  private activeLanguageServers = new Set<string>(); // workspace:language format
  private activeLanguages = new Set<string>(); // Track active language IDs for status

  private constructor() {
    this.setupDiagnosticsListener();
  }

  /**
   * Update the LSP status store with current state
   */
  private updateLspStatus() {
    const { actions } = useLspStore.getState();
    const workspaces = this.getActiveWorkspaces();
    const languages = Array.from(this.activeLanguages);

    if (this.activeLanguageServers.size > 0) {
      actions.updateLspStatus("connected", workspaces, undefined, languages);
    } else {
      actions.updateLspStatus("disconnected", [], undefined, []);
    }
  }

  static getInstance(): LspClient {
    if (!LspClient.instance) {
      LspClient.instance = new LspClient();
    }
    return LspClient.instance;
  }

  private async setupDiagnosticsListener() {
    try {
      console.log("[LSPClient] Setting up diagnostics listener...");
      const unlisten = await listen<PublishDiagnosticsParams>("lsp://diagnostics", (event) => {
        try {
          console.log("[LSPClient] Received diagnostics event:", JSON.stringify(event, null, 2));

          if (!event.payload) {
            console.error("[LSPClient] No payload in diagnostics event");
            return;
          }

          const { uri, diagnostics } = event.payload;

          if (!uri) {
            console.error("[LSPClient] No uri in diagnostics payload:", event.payload);
            return;
          }

          logger.debug("LSPClient", `Received diagnostics for ${uri}:`, diagnostics);

          // Convert URI to file path
          const filePath = uri.replace("file://", "");
          console.log(`[LSPClient] File path: ${filePath}`);

          // Convert LSP diagnostics to our internal format
          const diagnosticsList = diagnostics || [];
          const convertedDiagnostics = diagnosticsList.map((d) => convertLSPDiagnostic(d));
          console.log(
            `[LSPClient] Converted ${convertedDiagnostics.length} diagnostics for ${filePath}`,
          );

          // Update diagnostics store
          const { setDiagnostics } = useDiagnosticsStore.getState().actions;
          setDiagnostics(filePath, convertedDiagnostics);

          logger.info(
            "LSPClient",
            `Updated diagnostics for ${filePath}: ${convertedDiagnostics.length} items`,
          );

          // Log store state after update
          const currentState = useDiagnosticsStore.getState();
          console.log("[LSPClient] Diagnostics store state:", {
            size: currentState.diagnosticsByFile.size,
            files: Array.from(currentState.diagnosticsByFile.keys()),
          });
        } catch (innerError) {
          console.error("[LSPClient] Error processing diagnostics event:", innerError);
        }
      });
      console.log("[LSPClient] Diagnostics listener setup complete, unlisten:", unlisten);
    } catch (error) {
      console.error("[LSPClient] Failed to setup diagnostics listener:", error);
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

      // If no LSP server is configured, return early
      if (!serverPath) {
        logger.debug("LSPClient", `No LSP server configured for workspace ${workspacePath}`);
        return;
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
        // Extract language from server key and remove from active languages
        const language = server.split(":")[1];
        if (language) {
          const displayName = this.getLanguageDisplayName(language);
          this.activeLanguages.delete(displayName);
        }
      }

      // Update status store
      this.updateLspStatus();

      logger.debug("LSPClient", "LSP stopped successfully for workspace:", workspacePath);
    } catch (error) {
      logger.error("LSPClient", "Failed to stop LSP:", error);
      throw error;
    }
  }

  async startForFile(filePath: string, workspacePath: string): Promise<void> {
    try {
      logger.debug("LSPClient", "Starting LSP for file:", filePath);

      // Get LSP server info from extension registry
      const { extensionRegistry } = await import("@/extensions/registry/extension-registry");

      const serverPath = extensionRegistry.getLspServerPath(filePath) || undefined;
      const serverArgs = extensionRegistry.getLspServerArgs(filePath);
      const languageId = extensionRegistry.getLanguageId(filePath) || undefined;

      // If no LSP server is configured for this file type, return early
      if (!serverPath) {
        logger.debug("LSPClient", `No LSP server configured for ${filePath}`);
        return;
      }

      logger.info("LSPClient", `Using LSP server: ${serverPath} for language: ${languageId}`);

      // Check if this language server is already running for this file
      if (serverPath && languageId) {
        const serverKey = `${workspacePath}:${languageId}`;
        if (this.activeLanguageServers.has(serverKey)) {
          logger.debug("LSPClient", `LSP for ${languageId} already running for file`);
          return;
        }
      }

      // Track this language server BEFORE invoking backend to prevent race conditions
      if (languageId) {
        const serverKey = `${workspacePath}:${languageId}`;
        this.activeLanguageServers.add(serverKey);
        // Track language with proper display name
        const displayName = this.getLanguageDisplayName(languageId);
        this.activeLanguages.add(displayName);
        // Update status store
        this.updateLspStatus();
      }

      logger.info("LSPClient", `Invoking lsp_start_for_file with:`, {
        filePath,
        workspacePath,
        serverPath,
        serverArgs,
      });

      try {
        await invoke<void>("lsp_start_for_file", {
          filePath,
          workspacePath,
          serverPath,
          serverArgs,
        });
      } catch (error) {
        // If backend call fails, remove from tracking
        if (languageId) {
          const serverKey = `${workspacePath}:${languageId}`;
          this.activeLanguageServers.delete(serverKey);
          const displayName = this.getLanguageDisplayName(languageId);
          this.activeLanguages.delete(displayName);
          this.updateLspStatus();
        }
        throw error;
      }

      logger.debug("LSPClient", "LSP started successfully for file:", filePath);
    } catch (error) {
      logger.error("LSPClient", "Failed to start LSP for file:", error);
      // Update status to error
      const { actions } = useLspStore.getState();
      actions.setLspError(`Failed to start LSP: ${error}`);
      throw error;
    }
  }

  /**
   * Get display name for a language ID
   */
  private getLanguageDisplayName(languageId: string): string {
    const displayNames: Record<string, string> = {
      typescript: "TypeScript",
      javascript: "JavaScript",
      rust: "Rust",
      python: "Python",
      go: "Go",
      java: "Java",
      c: "C",
      cpp: "C++",
      csharp: "C#",
      ruby: "Ruby",
      php: "PHP",
      html: "HTML",
      css: "CSS",
      json: "JSON",
      yaml: "YAML",
      toml: "TOML",
      markdown: "Markdown",
      bash: "Bash",
    };
    return displayNames[languageId] || languageId;
  }

  async stopForFile(filePath: string): Promise<void> {
    try {
      logger.debug("LSPClient", "Stopping LSP for file:", filePath);
      await invoke<void>("lsp_stop_for_file", { filePath });
      logger.debug("LSPClient", "LSP stopped successfully for file:", filePath);
    } catch (error) {
      logger.error("LSPClient", "Failed to stop LSP for file:", error);
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

  async getDefinition(
    filePath: string,
    line: number,
    character: number,
  ): Promise<
    | {
        uri: string;
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
      }[]
    | null
  > {
    try {
      logger.debug("LSPClient", `Getting definition for ${filePath}:${line}:${character}`);
      const definition = await invoke<
        | {
            uri: string;
            range: {
              start: { line: number; character: number };
              end: { line: number; character: number };
            };
          }[]
        | null
      >("lsp_get_definition", {
        filePath,
        line,
        character,
      });
      if (definition) {
        logger.debug("LSPClient", `Got definition: ${JSON.stringify(definition)}`);
      }
      return definition;
    } catch (error) {
      logger.error("LSPClient", "LSP definition error:", error);
      return null;
    }
  }

  async getReferences(
    filePath: string,
    line: number,
    character: number,
  ): Promise<
    | {
        uri: string;
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
      }[]
    | null
  > {
    try {
      logger.debug("LSPClient", `Getting references for ${filePath}:${line}:${character}`);
      const references = await invoke<
        | {
            uri: string;
            range: {
              start: { line: number; character: number };
              end: { line: number; character: number };
            };
          }[]
        | null
      >("lsp_get_references", {
        filePath,
        line,
        character,
      });
      if (references) {
        logger.debug("LSPClient", `Got ${references.length} references`);
      }
      return references;
    } catch (error) {
      logger.error("LSPClient", "LSP references error:", error);
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
