import { describe, expect, it } from "vite-plus/test";
import {
  copyLineDown,
  copyLineUp,
  deleteLine,
  duplicateLine,
  moveLineDown,
  moveLineUp,
} from "../utils/line-operations";

describe("line operation utilities", () => {
  it("duplicates the current line below and preserves cursor column", () => {
    expect(duplicateLine("alpha\nbeta\ngamma", "alpha\nbe".length)).toEqual({
      content: "alpha\nbeta\nbeta\ngamma",
      selectionStart: "alpha\nbeta\nbe".length,
      selectionEnd: "alpha\nbeta\nbe".length,
    });
  });

  it("deletes the current line with its following newline", () => {
    expect(deleteLine("alpha\nbeta\ngamma", "alpha\nb".length)).toEqual({
      content: "alpha\ngamma",
      selectionStart: "alpha\n".length,
      selectionEnd: "alpha\n".length,
    });
  });

  it("keeps the previous newline when deleting the last line", () => {
    expect(deleteLine("alpha\nbeta", "alpha\nb".length)).toEqual({
      content: "alpha\n",
      selectionStart: "alpha\n".length,
      selectionEnd: "alpha\n".length,
    });
  });

  it("moves a line up and clamps the cursor to the moved line", () => {
    expect(moveLineUp("short\nvery-long\nend", "short\nvery-long".length)).toEqual({
      content: "very-long\nshort\nend",
      selectionStart: "very-long".length,
      selectionEnd: "very-long".length,
    });
  });

  it("moves a line down and preserves the cursor column", () => {
    expect(moveLineDown("one\ntwo\nthree", "on".length)).toEqual({
      content: "two\none\nthree",
      selectionStart: "two\non".length,
      selectionEnd: "two\non".length,
    });
  });

  it("does not move beyond file boundaries", () => {
    expect(moveLineUp("one\ntwo", 0)).toBeNull();
    expect(moveLineDown("one\ntwo", "one\ntwo".length)).toBeNull();
  });

  it("copies the current line above", () => {
    expect(copyLineUp("alpha\nbeta\ngamma", "alpha\nbe".length)).toEqual({
      content: "alpha\nbeta\nbeta\ngamma",
      selectionStart: "alpha\nbe".length,
      selectionEnd: "alpha\nbe".length,
    });
  });

  it("copies the current line below", () => {
    expect(copyLineDown("alpha\nbeta\ngamma", "alpha\nbe".length)).toEqual({
      content: "alpha\nbeta\nbeta\ngamma",
      selectionStart: "alpha\nbeta\nbe".length,
      selectionEnd: "alpha\nbeta\nbe".length,
    });
  });
});
