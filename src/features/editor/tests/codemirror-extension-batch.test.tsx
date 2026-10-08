// @vitest-environment jsdom
import { EditorState, type Extension, Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  beginCodeMirrorExtensionBatch,
  endCodeMirrorExtensionBatch,
  useCodeMirrorExtension,
} from "../engines/codemirror/host";

const installed = Facet.define<string>();
const extensions = new Map<string, Extension>();
const extensionFor = (name: string) => {
  let extension = extensions.get(name);
  if (!extension) {
    extension = installed.of(name);
    extensions.set(name, extension);
  }
  return extension;
};

function Feature({ view, name }: { view: EditorView; name: string }) {
  useCodeMirrorExtension(view, extensionFor(name));
  return null;
}

function Nested({ view, name }: { view: EditorView; name: string }) {
  useCodeMirrorExtension(view, extensionFor(name));
  return <Feature view={view} name={`${name}-child`} />;
}

function BatchStart({ view }: { view: EditorView }) {
  useLayoutEffect(() => beginCodeMirrorExtensionBatch(view), [view]);
  return null;
}

function BatchEnd({ view }: { view: EditorView }) {
  useLayoutEffect(() => endCodeMirrorExtensionBatch(view), [view]);
  return null;
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let view: EditorView;

beforeEach(() => {
  view = new EditorView({ state: EditorState.create({ doc: "a" }) });
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  view.destroy();
  vi.restoreAllMocks();
});

describe("CodeMirror extension batches", () => {
  it("installs the extensions of features mounting together in one transaction", () => {
    const dispatch = vi.spyOn(view, "dispatch");

    act(() =>
      root.render(
        <>
          <BatchStart view={view} />
          <Feature view={view} name="first" />
          <Nested view={view} name="second" />
          <Feature view={view} name="third" />
          <BatchEnd view={view} />
        </>,
      ),
    );

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(view.state.facet(installed)).toEqual(["first", "second-child", "second", "third"]);
  });

  it("installs the same order without a batch", () => {
    const dispatch = vi.spyOn(view, "dispatch");

    act(() =>
      root.render(
        <>
          <Feature view={view} name="first" />
          <Nested view={view} name="second" />
          <Feature view={view} name="third" />
        </>,
      ),
    );

    expect(dispatch).toHaveBeenCalledTimes(4);
    expect(view.state.facet(installed)).toEqual(["first", "second-child", "second", "third"]);
  });

  it("installs a feature mounting after the batch right away and removes it on unmount", () => {
    const render = (late: boolean) =>
      act(() =>
        root.render(
          <>
            <BatchStart view={view} />
            <Feature view={view} name="first" />
            {late ? <Feature view={view} name="late" /> : null}
            <BatchEnd view={view} />
          </>,
        ),
      );
    render(false);

    render(true);
    expect(view.state.facet(installed)).toEqual(["first", "late"]);

    render(false);
    expect(view.state.facet(installed)).toEqual(["first"]);
  });

  it("installs what a batch collected even when it is never ended", async () => {
    beginCodeMirrorExtensionBatch(view);
    act(() => root.render(<Feature view={view} name="first" />));
    expect(view.state.facet(installed)).toEqual([]);

    await Promise.resolve();

    expect(view.state.facet(installed)).toEqual(["first"]);
  });
});
