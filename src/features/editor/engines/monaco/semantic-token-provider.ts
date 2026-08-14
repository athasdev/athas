import type * as Monaco from "monaco-editor";
import type { LspSemanticTokensResponse } from "@/features/editor/lsp/semantic-token-types";
import { encodeMonacoSemanticTokens, MONACO_SEMANTIC_TOKEN_LEGEND } from "./semantic-tokens";

interface SemanticTokenClient {
  getActiveServerEntryForFile(filePath: string): unknown;
  getSemanticTokens(filePath: string): Promise<LspSemanticTokensResponse | null>;
  isDocumentOpen(filePath: string): boolean;
}

interface SemanticTokenProviderOptions {
  client: SemanticTokenClient;
  filePathFromModel(model: Monaco.editor.ITextModel): string;
  isLspModel(model: Monaco.editor.ITextModel): boolean;
  onDidChange?: Monaco.Emitter<void>["event"];
}

const SEMANTIC_TOKEN_RETRY_DELAY_MS = 15_000;

export function createMonacoSemanticTokenProvider({
  client,
  filePathFromModel,
  isLspModel,
  onDidChange,
}: SemanticTokenProviderOptions): Monaco.languages.DocumentSemanticTokensProvider {
  const pendingRequests = new Map<string, Promise<LspSemanticTokensResponse | null>>();
  const retryAfterByFile = new Map<string, { modelVersion: number; retryAfter: number }>();

  return {
    onDidChange,
    getLegend() {
      return MONACO_SEMANTIC_TOKEN_LEGEND;
    },
    async provideDocumentSemanticTokens(model, _lastResultId, cancellationToken) {
      if (cancellationToken.isCancellationRequested || !isLspModel(model)) return null;

      const filePath = filePathFromModel(model);
      if (!client.getActiveServerEntryForFile(filePath) || !client.isDocumentOpen(filePath)) {
        return null;
      }

      const modelVersion = model.getVersionId();
      const failedRequest = retryAfterByFile.get(filePath);
      if (failedRequest?.modelVersion === modelVersion && failedRequest.retryAfter > Date.now()) {
        return null;
      }

      const requestKey = `${filePath}:${modelVersion}`;
      let pendingRequest = pendingRequests.get(requestKey);
      if (!pendingRequest) {
        pendingRequest = client.getSemanticTokens(filePath).catch(() => null);
        pendingRequests.set(requestKey, pendingRequest);
        void pendingRequest.finally(() => pendingRequests.delete(requestKey));
      }

      const response = await pendingRequest;
      if (
        cancellationToken.isCancellationRequested ||
        model.isDisposed() ||
        model.getVersionId() !== modelVersion
      ) {
        return null;
      }

      if (!response) {
        retryAfterByFile.set(filePath, {
          modelVersion,
          retryAfter: Date.now() + SEMANTIC_TOKEN_RETRY_DELAY_MS,
        });
        return null;
      }

      retryAfterByFile.delete(filePath);
      if (response.tokenTypes.length === 0) return null;

      const data = encodeMonacoSemanticTokens(response, model);
      if (response.tokens.length > 0 && data.length === 0) return null;

      return {
        resultId: `${model.uri.toString()}:${modelVersion}`,
        data,
      };
    },
    releaseDocumentSemanticTokens() {},
  };
}
