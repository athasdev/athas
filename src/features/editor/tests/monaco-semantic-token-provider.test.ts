import { describe, expect, it, vi } from "vite-plus/test";
import type { LspSemanticTokensResponse } from "../lsp/semantic-token-types";
import { createMonacoSemanticTokenProvider } from "../engines/monaco/semantic-token-provider";

const response: LspSemanticTokensResponse = {
  tokenTypes: ["variable"],
  tokenModifiers: [],
  tokens: [{ line: 0, startChar: 0, length: 3, tokenType: 0, tokenModifiers: 0 }],
};

function model() {
  let version = 4;
  let disposed = false;
  return {
    uri: { toString: () => "athas:///repo/file.rs" },
    getLineCount: () => 1,
    getLineMaxColumn: () => 4,
    getVersionId: () => version,
    isDisposed: () => disposed,
    setVersion: (nextVersion: number) => {
      version = nextVersion;
    },
    dispose: () => {
      disposed = true;
    },
  };
}

function setup(getSemanticTokens = vi.fn(async () => response)) {
  const client = {
    getActiveServerEntryForFile: vi.fn(() => ({ key: "server" })),
    getSemanticTokens,
    isDocumentOpen: vi.fn(() => true),
  };
  const provider = createMonacoSemanticTokenProvider({
    client,
    filePathFromModel: () => "/repo/file.rs",
    isLspModel: () => true,
  });

  return { client, provider };
}

describe("Monaco semantic token provider", () => {
  it("returns translated semantic tokens for an open LSP document", async () => {
    const { client, provider } = setup();
    const textModel = model();

    const result = await provider.provideDocumentSemanticTokens(textModel as never, null, {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    });

    expect(client.getSemanticTokens).toHaveBeenCalledWith("/repo/file.rs");
    expect(result).toEqual({
      resultId: "athas:///repo/file.rs:4",
      data: Uint32Array.from([0, 0, 3, 8, 0]),
    });
  });

  it("falls through when the model has no active open LSP document", async () => {
    const { client, provider } = setup();
    client.isDocumentOpen.mockReturnValue(false);

    const result = await provider.provideDocumentSemanticTokens(model() as never, null, {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    });

    expect(result).toBeNull();
    expect(client.getSemanticTokens).not.toHaveBeenCalled();
  });

  it.each([
    [
      "canceled",
      (_textModel: ReturnType<typeof model>, token: { isCancellationRequested: boolean }) => {
        token.isCancellationRequested = true;
      },
    ],
    ["disposed", (textModel: ReturnType<typeof model>) => textModel.dispose()],
    ["stale", (textModel: ReturnType<typeof model>) => textModel.setVersion(5)],
  ])("discards %s responses", async (_name, invalidate) => {
    let resolveTokens: (value: LspSemanticTokensResponse) => void = () => {};
    const pendingTokens = new Promise<LspSemanticTokensResponse>((resolve) => {
      resolveTokens = resolve;
    });
    const { provider } = setup(vi.fn(() => pendingTokens));
    const textModel = model();
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    };
    const pendingResult = provider.provideDocumentSemanticTokens(
      textModel as never,
      null,
      cancellationToken,
    );

    invalidate(textModel, cancellationToken);
    resolveTokens(response);

    await expect(pendingResult).resolves.toBeNull();
  });

  it("falls through when the server has no semantic token legend", async () => {
    const { provider } = setup(
      vi.fn(async () => ({ tokens: [], tokenTypes: [], tokenModifiers: [] })),
    );

    const result = await provider.provideDocumentSemanticTokens(model() as never, null, {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    });

    expect(result).toBeNull();
  });

  it("falls through when every returned token is unsupported", async () => {
    const { provider } = setup(
      vi.fn(async () => ({
        tokenTypes: ["unknownCustomToken"],
        tokenModifiers: [],
        tokens: [{ line: 0, startChar: 0, length: 3, tokenType: 0, tokenModifiers: 0 }],
      })),
    );

    const result = await provider.provideDocumentSemanticTokens(model() as never, null, {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    });

    expect(result).toBeNull();
  });
});
