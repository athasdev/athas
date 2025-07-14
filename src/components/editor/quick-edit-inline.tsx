import { useEditorInstanceStore } from "../../stores/editor-instance";

export function QuickEditInline() {
  const {
    isInlineAssistantVisible,
    selectedText,
    assistantCursorPosition,
    setInlineAssistant,
    editorRef,
    value,
    onChange,
  } = useEditorInstanceStore();

  const handleClose = () => {
    setInlineAssistant(false);
    if (editorRef?.current) {
      editorRef.current.focus();
    }
  };

  const handleApplyEdit = (editedText: string) => {
    if (selectedText) {
      // Replace selected text
      const newValue = value.replace(selectedText, editedText);
      onChange(newValue);
    } else {
      // Insert at cursor position
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(editedText));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);

        // Trigger onChange
        const content = editorRef?.current?.textContent || "";
        onChange(content);
      }
    }
    setInlineAssistant(false);
  };

  if (!isInlineAssistantVisible) return null;

  return (
    <div
      className="fixed z-50 min-w-[300px] max-w-[600px] rounded border border-border bg-primary-bg p-4 shadow-lg"
      style={{
        left: assistantCursorPosition.x,
        top: assistantCursorPosition.y,
        transform: "translateX(-50%)",
      }}
    >
      <div className="mb-3">
        <h3 className="font-medium text-sm text-text">AI Quick Edit</h3>
        {selectedText && <p className="text-text-lighter text-xs">Editing selected text</p>}
      </div>

      <div className="mb-3">
        <textarea
          className="h-20 w-full resize-none rounded border border-border bg-secondary-bg p-2 font-mono text-sm"
          placeholder="Describe your edit or paste new code..."
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={handleClose}
          className="px-3 py-1 text-sm text-text-lighter hover:text-text"
        >
          Cancel
        </button>
        <button
          onClick={() => handleApplyEdit("// AI edit placeholder")}
          className="rounded bg-accent px-3 py-1 text-primary-bg text-sm hover:bg-accent/90"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
