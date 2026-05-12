import type { HighlightToken } from "./types";

export interface ViewportRangePayload {
  startLine: number;
  endLine: number;
}

export type TokenizerWorkerRequest =
  | { id: number; type: "warmup"; languages?: string[] }
  | { id: number; type: "reset"; bufferId: string }
  | {
      id: number;
      type: "tokenize";
      bufferId: string;
      content: string;
      languageId: string;
      wasmPath?: string;
      highlightQueryUrl?: string;
      mode: "full" | "range";
      viewportRange?: ViewportRangePayload;
    }
  | {
      id: number;
      type: "tokenizeSnippet";
      snippet: string;
      languageId: string;
      wasmPath?: string;
      highlightQueryUrl?: string;
    };

export type TokenizerWorkerResponse =
  | {
      id: number;
      ok: true;
      tokens?: HighlightToken[];
      normalizedText?: string;
    }
  | { id: number; ok: false; error: string };

export interface TokenizerWorkerResult {
  tokens: HighlightToken[];
  normalizedText: string;
}
