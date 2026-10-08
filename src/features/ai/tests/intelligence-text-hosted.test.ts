import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch: mocks.fetch }));
vi.mock("@/features/auth/services/auth-api", () => ({ getAuthToken: async () => "token" }));
vi.mock("../intelligence/services/intelligence-connection", () => ({
  getIntelligenceConnection: async () => ({
    providerId: "athas",
    modelId: "",
    userId: null,
    scope: "personal",
  }),
  assertIntelligenceConnectionAllowed: () => {},
}));
vi.mock("@/features/auth/stores/auth.store", () => ({
  useAuthStore: { getState: () => ({ user: null }) },
}));
vi.mock("../intelligence/stores/intelligence-settings.store", () => ({
  useIntelligenceSettingsStore: { getState: () => ({ scope: "personal" }) },
}));

import {
  InlineEditError,
  requestInlineEdit,
} from "../intelligence/services/intelligence-text-service";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Hosted Intelligence text requests", () => {
  it("rejects oversized selections before calling the server", async () => {
    const error = await requestInlineEdit({
      model: "",
      beforeSelection: "",
      selectedText: "x".repeat(12001),
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(InlineEditError);
    expect((error as InlineEditError).status).toBe(413);
    expect((error as InlineEditError).message).toContain("12,000 characters");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("turns a stalled request into a timeout error", async () => {
    mocks.fetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const error = await requestInlineEdit(
      { model: "", beforeSelection: "", selectedText: "code" },
      { timeoutMs: 5 },
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(InlineEditError);
    expect((error as InlineEditError).status).toBe(408);
  });

  it("keeps a user cancellation as an abort instead of a timeout", async () => {
    const controller = new AbortController();
    mocks.fetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const pending = requestInlineEdit(
      { model: "", beforeSelection: "", selectedText: "code" },
      { signal: controller.signal },
    ).catch((reason: unknown) => reason);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    controller.abort();
    expect(await pending).not.toBeInstanceOf(InlineEditError);
  });

  it("sends bounded autocomplete context with recent edits and diagnostics", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse({ completion: "value;\nreturn value;" }));
    const result = await requestInlineEdit({
      feature: "autocomplete",
      model: "",
      beforeSelection: "a".repeat(13000),
      selectedText: "",
      afterSelection: "b".repeat(5000),
      recentEdits: [{ filePath: "/src/a.ts", snippet: "const value = 1;" }],
      diagnostics: [{ line: 3, severity: "error", message: "Missing return" }],
    });
    expect(result.editedText).toBe("value;\nreturn value;");
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/ai\/autocomplete$/);
    const body = JSON.parse(String(init.body));
    expect(body.beforeCursor).toHaveLength(12000);
    expect(body.afterCursor).toHaveLength(4000);
    expect(body.model).toBeUndefined();
    expect(body.recentEdits).toEqual([{ filePath: "/src/a.ts", snippet: "const value = 1;" }]);
    expect(body.diagnostics).toEqual([{ line: 3, severity: "error", message: "Missing return" }]);
  });

  it("surfaces server errors with their status", async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({ error: "Athas AI needs Pro or pay-as-you-go balance." }, 402),
    );
    const error = await requestInlineEdit({
      model: "",
      beforeSelection: "",
      selectedText: "code",
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(InlineEditError);
    expect((error as InlineEditError).status).toBe(402);
  });
});
