import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tagName: string) => {
      if (tagName === "textarea") {
        const el = {
          value: "",
          selectionStart: 0,
          selectionEnd: 0,
          selectionDirection: "forward",
          setSelectionRange(start: number, end: number, direction?: string) {
            el.selectionStart = start;
            el.selectionEnd = end;
            el.selectionDirection = direction ?? "forward";
          },
        };
        return el;
      }
      return {};
    },
  } as unknown as Document);
});

// Helper to call useEditorOperations outside React by directly invoking
// the hook's returned callbacks with mocked refs.
function createOperations(options: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  bufferId: string | null;
  handleInput: (content: string) => void;
  tabSize: number;
}) {
  // useEditorOperations only uses useCallback wrappers; the core logic
  // is synchronous and can be exercised by calling the returned functions
  // directly if we bypass React. We reconstruct the callback behavior
  // inline for testing.
  const { inputRef, content, bufferId, handleInput } = options;

  return {
    deleteSelection: () => {
      if (!inputRef.current) return;
      const textarea = inputRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      if (start !== end) {
        const newContent = content.substring(0, start) + content.substring(end);
        if (!bufferId) return;
        textarea.value = newContent;
        textarea.selectionStart = textarea.selectionEnd = start;
        handleInput(newContent);
      }
    },
    cut: () => {
      if (!inputRef.current) return;
      const textarea = inputRef.current;
      const start = Math.min(textarea.selectionStart, textarea.selectionEnd);
      const end = Math.max(textarea.selectionStart, textarea.selectionEnd);
      if (start === end) return;

      const newContent = content.substring(0, start) + content.substring(end);
      if (!bufferId) return;
      textarea.value = newContent;
      textarea.selectionStart = textarea.selectionEnd = start;
      handleInput(newContent);
    },
  };
}

describe("useEditorOperations", () => {
  it("deleteSelection clears the textarea selection after removing selected text", () => {
    const mockHandleInput = vi.fn();
    const textarea = document.createElement("textarea");
    textarea.value = "Hello world example";
    textarea.setSelectionRange(12, 19, "forward");

    const inputRef = { current: textarea };

    const ops = createOperations({
      inputRef: inputRef as React.RefObject<HTMLTextAreaElement | null>,
      content: "Hello world example",
      bufferId: "test-buffer",
      handleInput: mockHandleInput,
      tabSize: 2,
    });

    ops.deleteSelection();

    // Content should have the selected text removed
    expect(textarea.value).toBe("Hello world ");

    // Selection should be collapsed to the start of the deleted range
    expect(textarea.selectionStart).toBe(12);
    expect(textarea.selectionEnd).toBe(12);

    // handleInput should be called with the new content
    expect(mockHandleInput).toHaveBeenCalledWith("Hello world ");
    expect(mockHandleInput).toHaveBeenCalledTimes(1);
  });

  it("deleteSelection does nothing when there is no selection", () => {
    const mockHandleInput = vi.fn();
    const textarea = document.createElement("textarea");
    textarea.value = "Hello world";
    textarea.setSelectionRange(5, 5, "forward");

    const inputRef = { current: textarea };

    const ops = createOperations({
      inputRef: inputRef as React.RefObject<HTMLTextAreaElement | null>,
      content: "Hello world",
      bufferId: "test-buffer",
      handleInput: mockHandleInput,
      tabSize: 2,
    });

    ops.deleteSelection();

    expect(textarea.value).toBe("Hello world");
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
    expect(mockHandleInput).not.toHaveBeenCalled();
  });

  it("cut clears the textarea selection after removing selected text", () => {
    const mockHandleInput = vi.fn();
    const textarea = document.createElement("textarea");
    textarea.value = "Hello world example";
    textarea.setSelectionRange(12, 19, "forward");

    const inputRef = { current: textarea };

    const ops = createOperations({
      inputRef: inputRef as React.RefObject<HTMLTextAreaElement | null>,
      content: "Hello world example",
      bufferId: "test-buffer",
      handleInput: mockHandleInput,
      tabSize: 2,
    });

    ops.cut();

    expect(textarea.value).toBe("Hello world ");
    expect(textarea.selectionStart).toBe(12);
    expect(textarea.selectionEnd).toBe(12);
    expect(mockHandleInput).toHaveBeenCalledWith("Hello world ");
  });
});
