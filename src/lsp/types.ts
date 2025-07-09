import type { CompletionItem, Diagnostic } from "vscode-languageserver-protocol";

export interface LSPConfig {
  command: string;
  args: string[];
  fileExtensions: string[];
  initializationOptions?: Record<string, any>;
}

export interface LSPCapabilities {
  completion: boolean;
  hover: boolean;
  diagnostics: boolean;
  formatting: boolean;
}

export interface CompletionContext {
  line: number;
  character: number;
  prefix: string;
  word: string;
  triggerCharacter?: string;
}

export interface LSPClientEvents {
  onDiagnostics?: (uri: string, diagnostics: Diagnostic[]) => void;
  onInitialized?: () => void;
  onError?: (error: Error) => void;
}

export interface CompletionResponse {
  items: CompletionItem[];
  isIncomplete?: boolean;
}
