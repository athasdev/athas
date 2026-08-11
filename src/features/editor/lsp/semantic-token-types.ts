export interface LspSemanticToken {
  line: number;
  startChar: number;
  length: number;
  tokenType: number;
  tokenModifiers: number;
}

export interface LspSemanticTokensResponse {
  tokens: LspSemanticToken[];
  tokenTypes: string[];
  tokenModifiers: string[];
}
