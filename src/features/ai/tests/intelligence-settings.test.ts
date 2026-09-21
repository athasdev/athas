import { describe, expect, it, vi } from "vite-plus/test";
import { createIntelligenceSettingsStore } from "../intelligence/stores/intelligence-settings.store";
import { defaultIntelligencePreferences } from "../intelligence/lib/intelligence-preferences";
import { resolveIntelligenceConnection } from "../intelligence/lib/resolve-intelligence-connection";
import type { IntelligenceSnapshot } from "../intelligence/types/intelligence.types";

vi.mock("../intelligence/services/intelligence-settings-api", () => ({
  fetchIntelligenceSettings: vi.fn(),
  IntelligenceSettingsError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));

function snapshot(scope = "personal", model = ""): IntelligenceSnapshot {
  return {
    scope,
    revision: 1,
    updatedAt: null,
    scopes: [
      { id: "personal", name: "Personal", canEdit: true },
      { id: "team:1", name: "Team", canEdit: true },
    ],
    preferences: {
      ...defaultIntelligencePreferences(),
      defaultConnection: { providerId: "openrouter", modelId: model },
    },
  };
}

function setup() {
  const cache = new Map<string, string>();
  const request = vi.fn(async (scope: string) => snapshot(scope));
  const store = createIntelligenceSettingsStore({
    request,
    storage: () => ({
      getItem: (key) => cache.get(key) ?? null,
      setItem: (key, value) => {
        cache.set(key, value);
      },
    }),
  });
  return { cache, request, store };
}

describe("Intelligence connection choices", () => {
  it("uses personal BYOK without Pro and honors explicit choices for Pro users", () => {
    const params = {
      task: "commit-message" as const,
      preferences: defaultIntelligencePreferences(),
      hasIntelligence: false,
      personalConnection: { providerId: "anthropic", modelId: "personal-model" },
    };
    expect(resolveIntelligenceConnection(params)).toEqual(params.personalConnection);
    expect(resolveIntelligenceConnection({ ...params, hasIntelligence: true }).providerId).toBe(
      "athas",
    );
    params.preferences.tasks["commit-message"] = { providerId: "vercel", modelId: "user/model" };
    expect(resolveIntelligenceConnection({ ...params, hasIntelligence: true })).toEqual({
      providerId: "vercel",
      modelId: "user/model",
    });
  });
});

describe("Intelligence settings sync", () => {
  it("stores signed-out preferences locally without requesting an account", async () => {
    const { store, request, cache } = setup();
    await store.getState().actions.setUser(null);
    store.getState().actions.change(snapshot().preferences);
    await store.getState().actions.save();
    expect(request).not.toHaveBeenCalled();
    expect(cache.has("athas.intelligence.local.personal")).toBe(true);
    expect(store.getState().dirty).toBe(false);
  });

  it("keeps local and account preferences separate across sign-in and sign-out", async () => {
    const { store, request } = setup();
    await store.getState().actions.setUser(null);
    store.getState().actions.change(snapshot("personal", "local").preferences);
    request.mockResolvedValue(snapshot("personal", "cloud"));
    await store.getState().actions.setUser(1);
    expect(store.getState().preferences.defaultConnection.modelId).toBe("cloud");
    await store.getState().actions.setUser(null);
    expect(store.getState().preferences.defaultConnection.modelId).toBe("local");
  });

  it("discards old account responses after switching users", async () => {
    const { store, request } = setup();
    let resolve!: (snapshot: IntelligenceSnapshot) => void;
    request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const first = store.getState().actions.setUser(1);
    request.mockResolvedValueOnce(snapshot("personal", "second"));
    await store.getState().actions.setUser(2);
    resolve(snapshot("personal", "first"));
    await first;
    expect(store.getState().userId).toBe(2);
    expect(store.getState().preferences.defaultConnection.modelId).toBe("second");
  });

  it("preserves unsaved drafts when another device updates the settings", async () => {
    const { store, request } = setup();
    await store.getState().actions.setUser(1);
    store.getState().actions.change(snapshot("personal", "draft").preferences);
    request.mockResolvedValue({ ...snapshot("personal", "other-device"), revision: 2 });
    await store.getState().actions.refresh();
    expect(store.getState().preferences.defaultConnection.modelId).toBe("draft");
    expect(store.getState().error).toContain("another device");
    await store.getState().actions.refresh(true);
    expect(store.getState().preferences.defaultConnection.modelId).toBe("other-device");
  });

  it("keeps personal and team drafts isolated", async () => {
    const { store } = setup();
    await store.getState().actions.setUser(1);
    store.getState().actions.change(snapshot("personal", "personal-draft").preferences);
    await store.getState().actions.setScope("team:1");
    store.getState().actions.change(snapshot("team:1", "team-draft").preferences);
    await store.getState().actions.setScope("personal");
    expect(store.getState().preferences.defaultConnection.modelId).toBe("personal-draft");
  });

  it("keeps a failed save available offline", async () => {
    const { store, request, cache } = setup();
    await store.getState().actions.setUser(1);
    store.getState().actions.change(snapshot("personal", "offline").preferences);
    request.mockRejectedValueOnce(new Error("Offline"));
    await store.getState().actions.save();
    expect(store.getState().dirty).toBe(true);
    expect(cache.get("athas.intelligence.1.personal")).toContain("offline");
  });
});
