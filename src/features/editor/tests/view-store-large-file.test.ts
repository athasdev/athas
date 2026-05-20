import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { usePaneStore } from "@/features/panes/stores/pane-store";
import { useBufferStore } from "../stores/buffer-store";
import { useEditorViewStore, applyIncrementalLineEdit } from "../stores/view-store";

describe("editor view store large files", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    usePaneStore.getState().actions.reset();
    useBufferStore.setState({
      buffers: [],
      activeBufferId: null,
      pendingClose: null,
      closedBuffersHistory: [],
    });
    useEditorViewStore.setState({
      lines: [""],
      lineCount: 1,
    });
  });

  it("tracks large active buffers by line count without storing every line", () => {
    const bufferActions = useBufferStore.getState().actions;
    const content = Array.from({ length: 50_000 }, (_, index) => `line ${index}`).join("\n");

    const bufferId = bufferActions.openContent({
      type: "editor",
      path: "/workspace/sqlite.c",
      name: "sqlite.c",
      content: "",
    });

    bufferActions.updateBufferContent(bufferId, content);

    const viewState = useEditorViewStore.getState();
    expect(viewState.lineCount).toBe(50_000);
    expect(viewState.lines).toHaveLength(0);
    expect(useEditorViewStore.getState().actions.getLines()).toHaveLength(50_000);
  });

  it("updates cached lines incrementally for small typing edits", () => {
    const previousContent = "first line\nsecond line\nthird line";
    const previousLines = previousContent.split("\n");

    expect(
      applyIncrementalLineEdit(
        previousContent,
        "first line\nsecond fast line\nthird line",
        previousLines,
      ),
    ).toEqual(["first line", "second fast line", "third line"]);

    expect(
      applyIncrementalLineEdit(
        previousContent,
        "first line\nsecond line\ninserted\nthird line",
        previousLines,
      ),
    ).toEqual(["first line", "second line", "inserted", "third line"]);

    expect(
      applyIncrementalLineEdit(previousContent, "first line\nthird line", previousLines),
    ).toEqual(["first line", "third line"]);

    expect(
      applyIncrementalLineEdit(previousContent, `x${".".repeat(1001)}`, previousLines),
    ).toBeNull();
  });

  it("matches full line rebuild for boundary edits", () => {
    const cases = [
      ["alpha\nbeta\ngamma", "xalpha\nbeta\ngamma"],
      ["alpha\nbeta\ngamma", "alpha\nxbeta\ngamma"],
      ["alpha\nbeta\ngamma", "alpha\nbeta\ngammax"],
      ["alpha\nbeta\ngamma", "alpha\nbeta\n\ngamma"],
      ["alpha\nbeta\ngamma", "alpha\nbe nta\ngamma"],
      ["alpha\nbeta\ngamma\n", "alpha\nbeta\ngamma\nx"],
      ["alpha\nbeta\ngamma", "alpha\nbeta"],
    ];

    for (const [previousContent, nextContent] of cases) {
      expect(
        applyIncrementalLineEdit(previousContent, nextContent, previousContent.split("\n")),
      ).toEqual(nextContent.split("\n"));
    }
  });
});
