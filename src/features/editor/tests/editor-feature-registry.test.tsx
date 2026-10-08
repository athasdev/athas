// @vitest-environment jsdom
import { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import type { CodeMirrorHost } from "../engines/codemirror/host";
import {
  getCodeMirrorFeatures,
  loadEditorFeatures,
  registerEditorFeatures,
  useEditorFeatures,
} from "../services/editor-feature-registry";

describe("editor feature registry", () => {
  it("mounts nothing until the contributions load, then every feature in slot order", async () => {
    const mounted: string[] = [];
    const feature = (name: string) =>
      function Feature() {
        mounted.push(name);
        return null;
      };
    let resolve!: () => void;
    const loaded = new Promise<void>((done) => {
      resolve = done;
    });
    registerEditorFeatures("test", async () => {
      await loaded;
      return { codeMirror: { overlays: [feature("first"), feature("second")] } };
    });

    const host = {} as CodeMirrorHost;
    function Features() {
      const contributions = useEditorFeatures();
      const Before = feature("built-in");
      return (
        <>
          <Before />
          {getCodeMirrorFeatures(contributions, "overlays").map((Feature, index) => (
            <Feature key={index} host={host} />
          ))}
        </>
      );
    }

    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(
        <Suspense fallback={null}>
          <Features />
        </Suspense>,
      ),
    );
    expect(mounted).toEqual([]);

    await act(async () => {
      resolve();
      await loaded;
    });
    expect(mounted).toEqual(["built-in", "first", "second"]);
    await act(async () => root.unmount());
  });

  it("replaces a loader registered again under the same id", async () => {
    const statusAction = () => null;
    registerEditorFeatures("reloaded", async () => ({ statusActions: [statusAction] }));
    registerEditorFeatures("reloaded", async () => ({ statusActions: [statusAction] }));

    const contributions = await loadEditorFeatures();
    expect(contributions.filter((contribution) => contribution.statusActions)).toHaveLength(1);
  });
});
