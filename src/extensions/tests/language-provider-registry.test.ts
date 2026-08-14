import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { languageProviderRegistry } from "../languages/language-provider-registry";

const provider = {
  id: "typescript",
  extensions: [".ts", ".tsx"],
  aliases: ["ts"],
  filenames: ["tsconfig.json"],
  getTokens: vi.fn(async () => []),
};

describe("language provider registry", () => {
  beforeEach(() => {
    languageProviderRegistry.unregister("athas.typescript:typescript");
    languageProviderRegistry.unregister("athas.other:typescript");
  });

  it("indexes one provider by language, extension, alias, and filename", () => {
    languageProviderRegistry.register("athas.typescript:typescript", provider);

    expect(languageProviderRegistry.get("typescript")).toBe(provider);
    expect(languageProviderRegistry.get(".ts")).toBe(provider);
    expect(languageProviderRegistry.get("tsx")).toBe(provider);
    expect(languageProviderRegistry.get("ts")).toBe(provider);
    expect(languageProviderRegistry.get("tsconfig.json")).toBe(provider);
  });

  it("does not remove a lookup key now owned by a newer provider", () => {
    const replacement = { ...provider, id: "typescript-next" };
    languageProviderRegistry.register("athas.typescript:typescript", provider);
    languageProviderRegistry.register("athas.other:typescript", replacement);

    languageProviderRegistry.unregister("athas.typescript:typescript");

    expect(languageProviderRegistry.get(".ts")).toBe(replacement);
    expect(languageProviderRegistry.get("typescript-next")).toBe(replacement);
  });

  it("replaces an extension registration atomically", () => {
    languageProviderRegistry.register("athas.typescript:typescript", provider);
    const replacement = { ...provider, id: "typescript-next", extensions: [".mts"] };

    languageProviderRegistry.register("athas.typescript:typescript", replacement);

    expect(languageProviderRegistry.get("typescript")).toBeUndefined();
    expect(languageProviderRegistry.get(".ts")).toBeUndefined();
    expect(languageProviderRegistry.get("mts")).toBe(replacement);
  });
});
