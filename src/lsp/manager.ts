import { Diagnostic } from "vscode-languageserver-protocol";
import { LSP_CONFIGS, getLanguageFromPath } from "./configs";
import { LSPClient } from "./lsp-client";
import { LSPClientEvents } from "./types";

export class LSPManager {
  private clients = new Map<string, LSPClient>();
  private workspaceRoot: string | null = null;
  private documentLanguages = new Map<string, string>();

  constructor(private onDiagnostics?: (uri: string, diagnostics: Diagnostic[]) => void) {}

  async setWorkspaceRoot(path: string): Promise<void> {
    if (this.workspaceRoot == path) {
      console.log(`LSPManager: workspace root is already set to ${path}`);
      return;
    }

    this.workspaceRoot = path;

    await this.disposeAll();
  }

  async openDocument(uri: string, content: string): Promise<void> {
    const language = getLanguageFromPath(uri);
    if (!language || !this.workspaceRoot) return;

    this.documentLanguages.set(uri, language);

    let client = this.clients.get(language);
    if (!client) {
      const config = LSP_CONFIGS[language];
      const events: LSPClientEvents = {
        onDiagnostics: this.onDiagnostics,
        onError: error => console.error(`LSP Error (${language}):`, error),
      };

      client = new LSPClient(language, config, events);
      await client.initialize(this.workspaceRoot);
      this.clients.set(language, client);
    }

    if (client.ready) {
      await client.didOpenTextDocument(uri, content);
    }
  }

  async changeDocument(uri: string, content: string): Promise<void> {
    const language = this.documentLanguages.get(uri);
    if (!language) return;

    const client = this.clients.get(language);
    if (client?.ready) {
      await client.didChangeTextDocument(uri, content);
    }
  }

  async closeDocument(uri: string): Promise<void> {
    const language = this.documentLanguages.get(uri);
    if (!language) return;

    const client = this.clients.get(language);
    if (client?.ready) {
      await client.didCloseTextDocument(uri);
    }

    this.documentLanguages.delete(uri);
  }

  async getCompletions(uri: string, line: number, character: number) {
    const language = this.documentLanguages.get(uri);
    if (!language) return [];

    const client = this.clients.get(language);
    if (!client?.ready) return [];

    return client.completion(uri, line, character);
  }

  async getHover(uri: string, line: number, character: number) {
    const language = this.documentLanguages.get(uri);
    if (!language) return null;

    const client = this.clients.get(language);
    if (!client?.ready) return null;

    return client.hover(uri, line, character);
  }

  async disposeAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.dispose();
    }

    this.clients.clear();
    this.documentLanguages.clear();
  }

  getAvailableLanguages(): string[] {
    return Object.keys(LSP_CONFIGS);
  }

  isLanguageSupported(filePath: string): boolean {
    return getLanguageFromPath(filePath) !== null;
  }
}
