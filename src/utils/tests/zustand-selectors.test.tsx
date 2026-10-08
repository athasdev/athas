// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { create } from "zustand";
import { createSelectors } from "../zustand-selectors";

interface ExampleState {
  count: number;
  label?: string;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("createSelectors", () => {
  it("selects keys that were missing from the initial state", () => {
    const useExampleStore = createSelectors(create<ExampleState>()(() => ({ count: 1 })));

    function Example() {
      const count = useExampleStore.use.count();
      const label = useExampleStore.use.label();
      return (
        <span>
          {count}:{label ?? "none"}
        </span>
      );
    }

    act(() => root.render(<Example />));
    expect(container.textContent).toBe("1:none");

    act(() => useExampleStore.setState({ count: 2, label: "set" }));
    expect(container.textContent).toBe("2:set");
  });

  it("returns the same hook for a key every time", () => {
    const useExampleStore = createSelectors(create<ExampleState>()(() => ({ count: 1 })));

    expect(useExampleStore.use.count).toBe(useExampleStore.use.count);
  });

  it("does not answer promise, serialization, React, or symbol probes with a hook", async () => {
    const useExampleStore = createSelectors(create<ExampleState>()(() => ({ count: 1 })));
    const selectors = useExampleStore.use as unknown as Record<PropertyKey, unknown>;

    expect(selectors.then).toBeUndefined();
    expect(selectors.toJSON).toBeUndefined();
    expect(selectors.$$typeof).toBeUndefined();
    expect(selectors[Symbol.iterator]).toBeUndefined();
    expect(selectors[Symbol.toPrimitive]).toBeUndefined();
    await expect(Promise.resolve(useExampleStore.use)).resolves.toBe(useExampleStore.use);
  });
});
