// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  getComposerText,
  getComposerTextBeforeCaret,
  getComposerTextRange,
  prepareComposerSlashCommand,
} from "../utils/chat-composer-dom";

let composer: HTMLDivElement;

beforeEach(() => {
  composer = document.createElement("div");
  composer.setAttribute("contenteditable", "true");
  document.body.append(composer);
});

afterEach(() => {
  composer.remove();
  window.getSelection()?.removeAllRanges();
});

describe("Composer slash command insertion", () => {
  it("preserves the draft and file tokens when a command is chosen from the toolbar", () => {
    composer.innerHTML =
      'Review <span contenteditable="false" data-mention data-mention-name="app.tsx">app.tsx</span> carefully';
    const mention = composer.querySelector("[data-mention]");
    const { startIndex, endIndex, search } = prepareComposerSlashCommand(composer);

    expect(getComposerText(composer)).toBe("Review @[app.tsx] carefully /");
    expect(search).toBe("");
    expect(document.activeElement).toBe(composer);
    expect(getComposerTextBeforeCaret(composer)).toBe(getComposerText(composer));

    const query = getComposerTextRange(composer, startIndex, endIndex);
    query.deleteContents();
    query.insertNode(document.createTextNode("/review"));
    expect(getComposerText(composer)).toBe("Review @[app.tsx] carefully /review");
    expect(composer.querySelector("[data-mention]")).toBe(mention);
  });

  it("reuses an unfinished trailing command instead of duplicating it", () => {
    composer.textContent = "Check this /rev";
    const result = prepareComposerSlashCommand(composer);
    expect(getComposerText(composer)).toBe("Check this /rev");
    expect(result.search).toBe("rev");
    expect(getComposerTextRange(composer, result.startIndex, result.endIndex).toString()).toBe(
      "/rev",
    );
  });

  it("keeps an already selected command token intact", () => {
    composer.innerHTML =
      '<span contenteditable="false" data-slash-command data-slash-command-name="review">Review code</span>';
    const token = composer.firstChild;
    const result = prepareComposerSlashCommand(composer);
    expect(getComposerText(composer)).toBe("/review /");
    expect(composer.firstChild).toBe(token);
    expect(result.search).toBe("");
    expect(getComposerTextRange(composer, result.startIndex, result.endIndex).toString()).toBe("/");
  });

  it("does not delete selected draft text and also supports an empty draft", () => {
    composer.textContent = "Keep this";
    const selection = window.getSelection()!;
    selection.addRange(getComposerTextRange(composer, 0, 9));
    prepareComposerSlashCommand(composer);
    expect(getComposerText(composer)).toBe("Keep this /");
    expect(selection.isCollapsed).toBe(true);

    composer.textContent = "";
    expect(prepareComposerSlashCommand(composer)).toEqual({
      startIndex: 0,
      endIndex: 1,
      search: "",
    });
    expect(getComposerText(composer)).toBe("/");
  });
});
