// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ fffSearchFiles: vi.fn() }));

vi.mock("../api/file-search-api", () => ({ fffSearchFiles: mocks.fffSearchFiles }));
vi.mock("../services/file-search-paths", () => ({
  getNativeWorkspaceRootPaths: (root: string | undefined) => (root ? [root] : []),
}));

import { useFffSearch } from "../hooks/use-fff-search";

let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useFffSearch> | null = null;

function Harness() {
  latest = useFffSearch("app", true, ["/repo"]);
  return null;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("useFffSearch", () => {
  it("treats a null answer from the search command as no hits", async () => {
    mocks.fffSearchFiles.mockResolvedValue(null);

    await act(async () => root.render(<Harness />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(latest?.hits).toEqual([]);
    expect(latest?.isSearching).toBe(false);
    expect(latest?.error).toBeNull();
  });
});
