import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const srcRoot = new URL("../../", import.meta.url);
const busSource = readFileSync(new URL("utils/app-events.ts", srcRoot), "utf8");

function collectSourceFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);

    if (entry.isDirectory()) return entry.name === "tests" ? [] : collectSourceFiles(url);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];

    return [url];
  });
}

const appSource = collectSourceFiles(srcRoot)
  .filter((url) => !url.pathname.endsWith("utils/app-events.ts"))
  .map((url) => readFileSync(url, "utf8"))
  .join("\n");

const eventMapBody = busSource.match(/export interface AppEventMap \{([\s\S]*?)\n\}/)?.[1] ?? "";
const eventNames = [...eventMapBody.matchAll(/^\s+"([^"]+)":/gm)].map(([, name]) => name);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCalledWith(callee: string, name: string) {
  return new RegExp(`\\b${callee}\\(\\s*"${escapeRegExp(name)}"`).test(appSource);
}

describe("app event contract", () => {
  it("reads the event names from AppEventMap", () => {
    expect(eventNames.length).toBeGreaterThan(40);
    expect(new Set(eventNames).size).toBe(eventNames.length);
  });

  it("emits every event somewhere in the app", () => {
    const withoutEmitter = eventNames.filter((name) => !isCalledWith("emitAppEvent", name));

    expect(withoutEmitter).toEqual([]);
  });

  it("listens to every event somewhere in the app", () => {
    const withoutListener = eventNames.filter(
      (name) => !isCalledWith("onAppEvent", name) && !isCalledWith("useAppEvent", name),
    );

    expect(withoutListener).toEqual([]);
  });

  it("no longer sends app events as window CustomEvents", () => {
    const stillOnWindow = eventNames.filter((name) =>
      new RegExp(`(new CustomEvent|EventListener)\\(\\s*"${escapeRegExp(name)}"`).test(appSource),
    );

    expect(stillOnWindow).toEqual([]);
  });
});
