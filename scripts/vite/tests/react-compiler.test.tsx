// @vitest-environment jsdom
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import babel from "@rolldown/plugin-babel";
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { build } from "vite-plus";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { create } from "zustand";
import { createSelectors } from "../../../src/utils/zustand-selectors";
import { createReactCompilerPreset } from "../react-compiler";

const require = createRequire(import.meta.url);
const entry = "/virtual-compiler-regression.js";
const selectorEntry = "/virtual-generated-selectors.js";
const storeModule = "@/features/editor/stores/editor-app.store";
const platformModule = "@/utils/platform";
const platformHook = path.resolve("src/features/window/hooks/use-platform-setup.ts");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it("preserves generated selector hooks through compiled parent renders and store updates", async () => {
  const cleanup = vi.fn();
  const applyPlatformClass = vi.fn();
  const useEditorAppStore = createSelectors(create(() => ({ count: 0, actions: { cleanup } })));
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "compiler-regression-fixture",
        resolveId(id) {
          if (id === entry || id === selectorEntry) return id;
        },
        load(id) {
          if (id === entry) {
            return `
              import { createElement } from 'react';
              import { usePlatformSetup } from ${JSON.stringify(platformHook)};
              import { GeneratedSelectors } from ${JSON.stringify(selectorEntry)};
              export function WorkbenchHarness({ label }) {
                usePlatformSetup();
                return createElement(GeneratedSelectors, { label });
              }
            `;
          }
          if (id === selectorEntry) {
            return `
              import { createElement, useLayoutEffect } from 'react';
              import { useEditorAppStore } from ${JSON.stringify(storeModule)};
              export function GeneratedSelectors({ label }) {
                const count = useEditorAppStore.use.count();
                const actions = useEditorAppStore['use'].actions();
                useLayoutEffect(() => {}, [actions]);
                return createElement('output', null, label + ':' + count);
              }
            `;
          }
        },
      },
      babel({ presets: [createReactCompilerPreset()] }),
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ["cjs"] },
      rolldownOptions: {
        external: ["react", "react/compiler-runtime", storeModule, platformModule],
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .find((output) => output.type === "chunk" && output.isEntry);
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing compiled regression fixture");
  expect(chunk.code).toContain("react/compiler-runtime");

  const compiled = { exports: {} as { WorkbenchHarness: ComponentType<{ label: string }> } };
  const loadModule = (id: string) => {
    if (id === storeModule) return { useEditorAppStore };
    if (id === platformModule) return { applyPlatformClass };
    return require(id);
  };
  runInNewContext(chunk.code, { require: loadModule, module: compiled, exports: compiled.exports });
  const { WorkbenchHarness } = compiled.exports;
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});

  await act(async () => root.render(createElement(WorkbenchHarness, { label: "first" })));
  expect(container.textContent).toBe("first:0");
  await act(async () => root.render(createElement(WorkbenchHarness, { label: "next" })));
  expect(container.textContent).toBe("next:0");
  await act(async () => useEditorAppStore.setState({ count: 7 }));
  expect(container.textContent).toBe("next:7");
  expect(applyPlatformClass).toHaveBeenCalledOnce();
  expect(cleanup).not.toHaveBeenCalled();
  expect(errors).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(cleanup).toHaveBeenCalledOnce();
});
