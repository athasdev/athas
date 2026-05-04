import { describe, expect, it } from "vite-plus/test";
import {
  readUpdatePreferences,
  shouldSuppressUpdate,
  writeUpdatePreferences,
} from "../lib/update-preferences";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("update preferences", () => {
  it("suppresses a skipped version only for that version", () => {
    expect(
      shouldSuppressUpdate({ version: "1.2.0" }, 1000, {
        skippedVersion: "1.2.0",
      }),
    ).toBe(true);
    expect(
      shouldSuppressUpdate({ version: "1.3.0" }, 1000, {
        skippedVersion: "1.2.0",
      }),
    ).toBe(false);
  });

  it("suppresses reminders until the stored time has passed", () => {
    expect(
      shouldSuppressUpdate({ version: "1.2.0" }, 1000, {
        remindVersion: "1.2.0",
        remindAfter: 2000,
      }),
    ).toBe(true);
    expect(
      shouldSuppressUpdate({ version: "1.2.0" }, 2000, {
        remindVersion: "1.2.0",
        remindAfter: 2000,
      }),
    ).toBe(false);
    expect(
      shouldSuppressUpdate({ version: "1.3.0" }, 1000, {
        remindVersion: "1.2.0",
        remindAfter: 2000,
      }),
    ).toBe(false);
  });

  it("reads and clears persisted preferences", () => {
    const storage = createStorage();

    writeUpdatePreferences({ skippedVersion: "1.2.0" }, storage);
    expect(readUpdatePreferences(storage)).toEqual({ skippedVersion: "1.2.0" });

    writeUpdatePreferences({}, storage);
    expect(readUpdatePreferences(storage)).toEqual({});
  });
});
