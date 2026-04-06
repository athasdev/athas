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
import type {
  ApplyDiagnosticCodeActionResult,
  Diagnostic,
  DiagnosticCodeAction,
} from "@/features/diagnostics/types/diagnostics";
import { hasTextContent } from "@/features/panes/types/pane-content";
import { useBufferStore } from "../stores/buffer-store";
import { logger } from "../utils/logger";
import { useLspStore } from "./lsp-store";

export interface LspError {
  message: string;
}

function stringifyLspError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function isBenignHoverError(error: unknown): boolean {
  const message = stringifyLspError(error).toLowerCase();
  return (
    message.includes("column is beyond end of line") ||
    message.includes("column is beyond end of file") ||
    message.includes("no lsp client for this file")
  );
}

export class LspClient {
  private static instance: LspClient | null = null;
  private activeLanguageServers = new Set<string>(); // workspace:language format
  private activeLanguages = new Set<string>(); // Track active language IDs for status
  private activeServerFiles = new Map<string, string>(); // workspace:language -> file path

  private constructor() {
    this.setupDiagnosticsListener();
    this.setupCrashListener();
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

  private findServerKeyForFile(filePath: string, languageId?: string): string | null {
    if (languageId) {
      const directMatch = Array.from(this.activeServerFiles.entries()).find(
        ([key, trackedFilePath]) => trackedFilePath === filePath && key.endsWith(`:${languageId}`),
      );
      if (directMatch) return directMatch[0];
    }

    const fallbackMatch = Array.from(this.activeServerFiles.entries()).find(
      ([, trackedFilePath]) => trackedFilePath === filePath,
    );
    return fallbackMatch?.[0] ?? null;
  }

  private parseServerKey(serverKey: string): { workspacePath: string; languageId: string } {
    const separatorIndex = serverKey.lastIndexOf(":");
    if (separatorIndex === -1) {
      return { workspacePath: serverKey, languageId: "" };
    }

    return {
      workspacePath: serverKey.slice(0, separatorIndex),
      languageId: serverKey.slice(separatorIndex + 1),
    };
  }

  getActiveServerEntries(): Array<{
    key: string;
    workspacePath: string;
    languageId: string;
    displayName: string;
    filePath: string | null;
  }> {
    return Array.from(this.activeLanguageServers)
      .map((key) => {
        const { workspacePath, languageId } = this.parseServerKey(key);
        return {
          key,
          workspacePath,
          languageId,
          displayName: this.getLanguageDisplayName(languageId),
          filePath: this.activeServerFiles.get(key) ?? null,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  static getInstance(): LspClient {
    if (!LspClient.instance) {
      LspClient.instance = new LspClient();
    }
    return LspClient.instance;
  }

  private async setupDiagnosticsListener() {
    try {
      logger.debug("LSPClient", "Setting up diagnostics listener");
      const unlisten = await listen<PublishDiagnosticsParams>("lsp://diagnostics", (event) => {
        try {
          if (!event.payload) {
            logger.error("LSPClient", "No payload in diagnostics event");
            return;
          }

          const { uri, diagnostics } = event.payload;

          if (!uri) {
            logger.error("LSPClient", "No uri in diagnostics payload:", event.payload);
            return;
          }

          logger.debug("LSPClient", `Received diagnostics for ${uri}:`, diagnostics);

          // Convert URI to file path
          const filePath = uri.replace("file://", "");

          // Convert LSP diagnostics to our internal format
          const diagnosticsList = diagnostics || [];
          const convertedDiagnostics = diagnosticsList.map((d) =>
            convertLSPDiagnostic(filePath, d),
          );
          logger.debug(
            "LSPClient",
            `Converted ${convertedDiagnostics.length} diagnostics for ${filePath}`,
          );

          // Update diagnostics store
          const { setDiagnostics } = useDiagnosticsStore.getState().actions;
          setDiagnostics(filePath, convertedDiagnostics);

          logger.debug(
            "LSPClient",
            `Updated diagnostics for ${filePath}: ${convertedDiagnostics.length} items`,
          );
        } catch (innerError) {
          logger.error("LSPClient", "Error processing diagnostics event:", innerError);
        }
      });
      logger.debug("LSPClient", "Diagnostics listener setup complete", unlisten);
    } catch (error) {
      logger.error("LSPClient", "Failed to setup diagnostics listener:", error);
    }
  }

  private async setupCrashListener() {
    try {
      await listen("lsp://server-crashed", () => {
        logger.warn("LSPClient", "LSP server crashed, attempting auto-restart");
        const { actions } = useLspStore.getState();
        actions.setLspError("Language server crashed");

        // Auto-restart all tracked servers after a short delay
        setTimeout(() => {
          this.restartAllTrackedServers().catch((error) => {
            logger.error("LSPClient", "Failed to auto-restart LSP servers:", error);
          });
        }, 2000);
      });
      logger.debug("LSPClient", "Crash listener setup complete");
    } catch (error) {
      logger.error("LSPClient", "Failed to setup crash listener:", error);
    }
  }

  async start(workspacePath: string, filePath?: string): Promise<void> {
    try {
      logger.debug("LSPClient", "Starting LSP with workspace:", workspacePath);

      // Get LSP server info from extension registry if file path is provided
      let serverPath: string | undefined;
      let serverArgs: string[] | undefined;
      let languageId: string | undefined;
      let initOptions: Record<string, unknown> | undefined;

      if (filePath) {
        const { extensionRegistry } = await import("@/extensions/registry/extension-registry");

        serverPath = extensionRegistry.getLspServerPath(filePath) || undefined;
        serverArgs = extensionRegistry.getLspServerArgs(filePath);
        languageId = extensionRegistry.getLanguageId(filePath) || undefined;
        initOptions = extensionRegistry.getLspInitializationOptions(filePath);

        logger.debug("LSPClient", `Using LSP server: ${serverPath} for language: ${languageId}`);

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
        if (languageId) {
          logger.warn(
            "LSPClient",
            `LSP configured for language '${languageId}' but server binary is missing (file: ${filePath})`,
          );
        } else {
          logger.debug("LSPClient", `No LSP server configured for workspace ${workspacePath}`);
        }
        return;
      }

      logger.debug("LSPClient", `Invoking lsp_start with:`, {
        workspacePath,
        serverPath,
        serverArgs,
      });

      await invoke<void>("lsp_start", {
        workspacePath,
        serverPath,
        serverArgs,
        initializationOptions: initOptions || null,
      });

      // Track this language server
      if (languageId) {
        const serverKey = `${workspacePath}:${languageId}`;
        this.activeLanguageServers.add(serverKey);
        if (filePath) {
          this.activeServerFiles.set(serverKey, filePath);
        }
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
        this.activeServerFiles.delete(server);
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
      const initializationOptions = extensionRegistry.getLspInitializationOptions(filePath);

      // If no LSP server is configured for this file type, return early
      if (!serverPath) {
        if (languageId) {
          logger.warn(
            "LSPClient",
            `LSP configured for language '${languageId}' but server binary is missing (file: ${filePath})`,
          );
        } else {
          logger.debug("LSPClient", `No LSP server configured for ${filePath}`);
        }
        return;
      }

      logger.debug("LSPClient", `Using LSP server: ${serverPath} for language: ${languageId}`);

      // Track this language server BEFORE invoking backend to prevent race conditions
      if (languageId) {
        const serverKey = `${workspacePath}:${languageId}`;
        this.activeLanguageServers.add(serverKey);
        this.activeServerFiles.set(serverKey, filePath);
        // Track language with proper display name
        const displayName = this.getLanguageDisplayName(languageId);
        this.activeLanguages.add(displayName);
        // Update status store
        this.updateLspStatus();
      }

      logger.debug("LSPClient", `Invoking lsp_start_for_file with:`, {
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
          initializationOptions: initializationOptions || null,
        });
      } catch (error) {
        // If backend call fails, remove from tracking
        if (languageId) {
          const serverKey = `${workspacePath}:${languageId}`;
          this.activeLanguageServers.delete(serverKey);
          this.activeServerFiles.delete(serverKey);
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
      actions.setLspError(`Failed to start LSP: ${stringifyLspError(error)}`);
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
      const { extensionRegistry } = await import("@/extensions/registry/extension-registry");
      const languageId = extensionRegistry.getLanguageId(filePath) || undefined;
      await invoke<void>("lsp_stop_for_file", { filePath });

      if (languageId) {
        const activeKey = this.findServerKeyForFile(filePath, languageId);
        if (activeKey) {
          this.activeLanguageServers.delete(activeKey);
          this.activeServerFiles.delete(activeKey);
        }

        const displayName = this.getLanguageDisplayName(languageId);
        const stillActiveForLanguage = Array.from(this.activeLanguageServers).some((key) =>
          key.endsWith(`:${languageId}`),
        );
        if (!stillActiveForLanguage) {
          this.activeLanguages.delete(displayName);
        }

        this.updateLspStatus();
      }

      logger.debug("LSPClient", "LSP stopped successfully for file:", filePath);
    } catch (error) {
      logger.error("LSPClient", "Failed to stop LSP for file:", error);
      throw error;
    }
  }

  async stopTrackedServer(serverKey: string): Promise<void> {
    const filePath = this.activeServerFiles.get(serverKey);
    if (!filePath) {
      const { workspacePath } = this.parseServerKey(serverKey);
      await this.stop(workspacePath);
      return;
    }

    await this.stopForFile(filePath);
  }

  async restartForFile(filePath: string, workspacePath: string, content: string): Promise<void> {
    const { actions } = useLspStore.getState();

    try {
      actions.updateLspStatus("connecting");
      actions.clearLspError();

      await this.notifyDocumentClose(filePath);
      await this.stopForFile(filePath);
      await this.startForFile(filePath, workspacePath);
      await this.notifyDocumentOpen(filePath, content);
    } catch (error) {
      logger.error("LSPClient", "Failed to restart LSP for file:", error);
      actions.setLspError(`Failed to restart LSP: ${stringifyLspError(error)}`);
      throw error;
    }
  }

  async restartTrackedServer(serverKey: string): Promise<void> {
    const filePath = this.activeServerFiles.get(serverKey);
    if (!filePath) {
      throw new Error("No tracked file for this language server");
    }

    const buffer = useBufferStore.getState().buffers.find((entry) => entry.path === filePath);
    const content = buffer && hasTextContent(buffer) ? buffer.content : "";
    await this.restartForFile(filePath, this.parseServerKey(serverKey).workspacePath, content);
  }

  async restartAllTrackedServers(): Promise<void> {
    const serverKeys = this.getActiveServerEntries().map((entry) => entry.key);
    for (const serverKey of serverKeys) {
      await this.restartTrackedServer(serverKey);
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
      if (!isBenignHoverError(error)) {
        logger.error("LSPClient", "LSP hover error:", error);
      }
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

  async getSemanticTokens(filePath: string): Promise<
    {
      line: number;
      startChar: number;
      length: number;
      tokenType: number;
      tokenModifiers: number;
    }[]
  > {
    try {
      return await invoke("lsp_get_semantic_tokens", { filePath });
    } catch (error) {
      logger.error("LSPClient", "LSP semantic tokens error:", error);
      return [];
    }
  }

  async getCodeLens(filePath: string): Promise<
    {
      line: number;
      title: string;
      command?: string;
    }[]
  > {
    try {
      return await invoke("lsp_get_code_lens", { filePath });
    } catch (error) {
      logger.error("LSPClient", "LSP code lens error:", error);
      return [];
    }
  }

  async getInlayHints(
    filePath: string,
    startLine: number,
    endLine: number,
  ): Promise<
    {
      line: number;
      character: number;
      label: string;
      kind?: string;
      paddingLeft: boolean;
      paddingRight: boolean;
    }[]
  > {
    try {
      return await invoke("lsp_get_inlay_hints", {
        filePath,
        startLine,
        endLine,
      });
    } catch (error) {
      logger.error("LSPClient", "LSP inlay hints error:", error);
      return [];
    }
  }

  async getDocumentSymbols(filePath: string): Promise<
    {
      name: string;
      kind: string;
      detail?: string;
      line: number;
      character: number;
      endLine: number;
      endCharacter: number;
      containerName?: string;
    }[]
  > {
    try {
      logger.debug("LSPClient", `Getting document symbols for ${filePath}`);
      const symbols = await invoke<
        {
          name: string;
          kind: string;
          detail?: string;
          line: number;
          character: number;
          endLine: number;
          endCharacter: number;
          containerName?: string;
        }[]
      >("lsp_get_document_symbols", { filePath });
      logger.debug("LSPClient", `Got ${symbols.length} document symbols`);
      return symbols;
    } catch (error) {
      logger.error("LSPClient", "LSP document symbols error:", error);
      return [];
    }
  }

  async getSignatureHelp(
    filePath: string,
    line: number,
    character: number,
  ): Promise<{
    signatures: {
      label: string;
      documentation?: { kind: string; value: string } | string;
      parameters?: {
        label: string | [number, number];
        documentation?: { kind: string; value: string } | string;
      }[];
      activeParameter?: number;
    }[];
    activeSignature?: number;
    activeParameter?: number;
  } | null> {
    try {
      return await invoke("lsp_get_signature_help", {
        filePath,
        line,
        character,
      });
    } catch (error) {
      logger.error("LSPClient", "LSP signature help error:", error);
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

  async rename(
    filePath: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<{
    changes?: Record<
      string,
      {
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        newText: string;
      }[]
    >;
  } | null> {
    try {
      logger.debug("LSPClient", `Renaming at ${filePath}:${line}:${character} to "${newName}"`);
      const result = await invoke<{
        changes?: Record<
          string,
          {
            range: {
              start: { line: number; character: number };
              end: { line: number; character: number };
            };
            newText: string;
          }[]
        >;
      } | null>("lsp_rename", {
        filePath,
        line,
        character,
        newName,
      });
      if (result) {
        logger.debug("LSPClient", `Rename result: ${JSON.stringify(result)}`);
      }
      return result;
    } catch (error) {
      logger.error("LSPClient", "LSP rename error:", error);
      return null;
    }
  }

  async getCodeActions(filePath: string, diagnostic: Diagnostic): Promise<DiagnosticCodeAction[]> {
    try {
      return await invoke<DiagnosticCodeAction[]>("lsp_get_code_actions", {
        filePath,
        diagnostic: {
          line: diagnostic.line,
          column: diagnostic.column,
          endLine: diagnostic.endLine,
          endColumn: diagnostic.endColumn,
          message: diagnostic.message,
          source: diagnostic.source,
          code: diagnostic.code,
          severity: diagnostic.severity,
        },
      });
    } catch (error) {
      logger.warn("LSPClient", "LSP code action request failed:", error);
      return [];
    }
  }

  async applyCodeAction(
    filePath: string,
    actionPayload: unknown,
  ): Promise<ApplyDiagnosticCodeActionResult> {
    try {
      return await invoke<ApplyDiagnosticCodeActionResult>("lsp_apply_code_action", {
        filePath,
        actionPayload,
      });
    } catch (error) {
      logger.warn("LSPClient", "LSP apply code action failed:", error);
      return {
        applied: false,
        reason: stringifyLspError(error),
      };
    }
  }

  async notifyDocumentOpen(filePath: string, content: string): Promise<void> {
    try {
      logger.debug("LSPClient", `Opening document: ${filePath}`);
      const { extensionRegistry } = await import("@/extensions/registry/extension-registry");
      const languageId = extensionRegistry.getLanguageId(filePath) || undefined;
      await invoke<void>("lsp_document_open", { filePath, content, languageId });
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
