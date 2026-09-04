import { describe, expect, it } from "vitest";
import { claimContextualTip } from "../lib/contextual-teaching";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("contextual teaching", () => {
  it("claims each tip only once", () => {
    const storage = createStorage();
    expect(claimContextualTip("agent-queue-controls", storage)).toBe(true);
    expect(claimContextualTip("agent-queue-controls", storage)).toBe(false);
    expect(claimContextualTip("global-search-shortcut", storage)).toBe(true);
  });

  it("stays quiet when persistence is unavailable", () => {
    const storage = {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {},
    };

    expect(claimContextualTip("global-search-shortcut", storage)).toBe(false);
  });
});
