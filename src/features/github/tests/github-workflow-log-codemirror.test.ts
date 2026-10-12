// @vitest-environment jsdom
import { foldable } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const handleFileSelect = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: { getState: () => ({ handleFileSelect }) },
}));

import { updateWorkflowLog, workflowLogExtension } from "../lib/github-workflow-log-codemirror";
import { buildWorkflowLogModel, type WorkflowLogModel } from "../utils/github-workflow-log-model";
import { parseWorkflowLog } from "../utils/github-workflow-logs";

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const ESC = String.fromCharCode(27);

const rawLog = [
  "2026-09-06T23:20:59.0000000Z Current runner version: '2.320.0'",
  "2026-09-06T23:21:00.1234567Z ##[group]Run actions/checkout@v4",
  "2026-09-06T23:21:00.2000000Z with:",
  "2026-09-06T23:21:00.3000000Z ##[endgroup]",
  "2026-09-06T23:21:01.0000000Z ##[group]Run cargo clippy",
  `2026-09-06T23:21:02.0000000Z ${ESC}[31merror${ESC}[0m: unused variable`,
  "2026-09-06T23:21:02.5000000Z   --> src/main.rs:12:9",
  "2026-09-06T23:21:02.6000000Z   --> ./lib/util.ts:3",
  "2026-09-06T23:21:03.0000000Z ##[error]Process completed with exit code 101.",
].join("\n");

let view: EditorView | null = null;

function createView(model: WorkflowLogModel) {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({ doc: model.text, extensions: [workflowLogExtension] }),
  });
  return view;
}

function fileLinks(editor: EditorView) {
  return [...editor.dom.querySelectorAll<HTMLElement>(".gha-log-file-link")].map((link) => ({
    text: link.textContent,
    path: link.dataset.path,
    line: link.dataset.line,
    column: link.dataset.column,
  }));
}

function mousedownOn(element: Element, init: MouseEventInit) {
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  handleFileSelect.mockClear();
});

afterEach(() => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = null;
});

describe("workflow log CodeMirror extension", () => {
  const model = buildWorkflowLogModel(parseWorkflowLog(rawLog), { showTimestamps: false });

  it("draws nothing until a log model is provided", () => {
    const editor = createView(model);

    expect(editor.dom.querySelectorAll(".gha-log-file-link")).toHaveLength(0);
    expect(foldable(editor.state, 0, editor.state.doc.line(1).to)).toBeNull();
  });

  it("folds group blocks from the model", () => {
    const editor = createView(model);
    updateWorkflowLog(editor, {
      model,
      showTimestamps: false,
      highlightLine: null,
      repoPath: null,
    });

    const groupHeader = editor.state.doc.line(2);
    expect(foldable(editor.state, groupHeader.from, groupHeader.to)).toEqual({
      from: groupHeader.to,
      to: editor.state.doc.line(3).to,
    });
    const plainLine = editor.state.doc.line(1);
    expect(foldable(editor.state, plainLine.from, plainLine.to)).toBeNull();
  });

  it("links file references relative to the repository", () => {
    const editor = createView(model);
    updateWorkflowLog(editor, {
      model,
      showTimestamps: false,
      highlightLine: 6,
      repoPath: "/repo/",
    });

    expect(fileLinks(editor)).toEqual(
      expect.arrayContaining([
        { text: "src/main.rs:12:9", path: "/repo/src/main.rs", line: "12", column: "9" },
      ]),
    );
    expect(fileLinks(editor)).toContainEqual({
      text: "./lib/util.ts:3",
      path: "/repo/lib/util.ts",
      line: "3",
      column: "",
    });
    expect(editor.dom.querySelector(".gha-log-line-highlight")).not.toBeNull();
    expect(editor.dom.querySelector(".gha-log-ansi-red")?.textContent).toBe("error");
  });

  it("links absolute paths only when they are inside the repository", () => {
    const absoluteModel = buildWorkflowLogModel(
      parseWorkflowLog(
        [
          "2026-09-06T23:21:02.5000000Z   --> /repo/src/main.rs:12:9",
          "2026-09-06T23:21:02.6000000Z   --> /home/runner/work/app/src/lib.rs:4",
          "2026-09-06T23:21:02.7000000Z   --> /repo/../etc/hosts.txt:1",
        ].join("\n"),
      ),
      { showTimestamps: false },
    );
    const editor = createView(absoluteModel);
    updateWorkflowLog(editor, {
      model: absoluteModel,
      showTimestamps: false,
      highlightLine: null,
      repoPath: "/repo",
    });

    expect(fileLinks(editor)).toEqual([
      { text: "/repo/src/main.rs:12:9", path: "/repo/src/main.rs", line: "12", column: "9" },
    ]);
  });

  it("keeps relative paths when no repository is known", () => {
    const editor = createView(model);
    updateWorkflowLog(editor, {
      model,
      showTimestamps: false,
      highlightLine: null,
      repoPath: null,
    });

    expect(fileLinks(editor)[0]).toMatchObject({ path: "src/main.rs" });
  });

  it("opens a linked file at its position on a modifier click", () => {
    const editor = createView(model);
    updateWorkflowLog(editor, {
      model,
      showTimestamps: false,
      highlightLine: null,
      repoPath: "/repo",
    });
    const link = editor.dom.querySelector(".gha-log-file-link");
    expect(link).not.toBeNull();

    mousedownOn(link!, { button: 0 });
    mousedownOn(link!, { button: 2, metaKey: true, ctrlKey: true });
    expect(handleFileSelect).not.toHaveBeenCalled();

    const event = mousedownOn(link!, { button: 0, metaKey: true, ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(handleFileSelect).toHaveBeenCalledWith("/repo/src/main.rs", false, 12, 9);
  });

  it("ignores modifier clicks outside file links", () => {
    const editor = createView(model);
    updateWorkflowLog(editor, {
      model,
      showTimestamps: false,
      highlightLine: null,
      repoPath: null,
    });

    mousedownOn(editor.contentDOM.querySelector(".cm-line")!, {
      button: 0,
      metaKey: true,
      ctrlKey: true,
    });

    expect(handleFileSelect).not.toHaveBeenCalled();
  });

  it("rebuilds links when timestamps are toggled on", () => {
    const withTimestamps = buildWorkflowLogModel(parseWorkflowLog(rawLog), {
      showTimestamps: true,
    });
    const editor = createView(withTimestamps);
    updateWorkflowLog(editor, {
      model: withTimestamps,
      showTimestamps: true,
      highlightLine: null,
      repoPath: null,
    });

    expect(fileLinks(editor)[0]).toMatchObject({ text: "src/main.rs:12:9" });
    expect(editor.dom.querySelector(".gha-log-timestamp")).not.toBeNull();
  });
});
