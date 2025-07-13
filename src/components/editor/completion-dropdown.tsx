import { useEditorInstanceStore } from "../../stores/editor-instance";

export function CompletionDropdown() {
  const {
    isLspCompletionVisible,
    lspCompletions,
    selectedLspIndex,
    completionPosition,
    setLspCompletion,
    editorRef,
  } = useEditorInstanceStore();

  if (!isLspCompletionVisible) return null;

  const handleSelect = (_completion: any) => {
    // Apply LSP completion logic
    if (editorRef?.current) {
      // This would contain the actual completion application logic
      // For now, just close the dropdown
      setLspCompletion(false);
    }
  };

  // const handleClose = () => {
  //   setLspCompletion(false);
  // };

  return (
    <div
      className="fixed z-50 min-w-[200px] max-w-[400px] rounded border border-border bg-primary-bg shadow-lg"
      style={{
        left: completionPosition.x,
        top: completionPosition.y,
      }}
    >
      <div className="max-h-[300px] overflow-y-auto">
        {lspCompletions.map((item, index) => (
          <div
            key={index}
            className={`cursor-pointer px-3 py-2 text-sm hover:bg-hover ${
              index === selectedLspIndex ? "bg-accent text-primary-bg" : ""
            }`}
            onClick={() => handleSelect(item)}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono">{item.label}</span>
              {item.detail && <span className="text-text-lighter text-xs">{item.detail}</span>}
            </div>
            {item.documentation && (
              <div className="mt-1 text-text-light text-xs">
                {typeof item.documentation === "string"
                  ? item.documentation
                  : item.documentation.value}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
