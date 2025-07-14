import { useEffect, useRef, useState } from "react";
import { useEditorConfigStore } from "../../stores/editor-config";
import { useEditorInstanceStore } from "../../stores/editor-instance";

export function VimCommandLine() {
  const vimEnabled = useEditorConfigStore(state => state.vimEnabled);
  const {
    isVimCommandLineVisible,
    vimCommandLineInitialCommand,
    setVimCommandLine,
    editorRef,
    vimEngine,
    value,
  } = useEditorInstanceStore();

  const [command, setCommand] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isVimCommandLineVisible) {
      setCommand(vimCommandLineInitialCommand);
      // Focus the input after a short delay to ensure it's rendered
      setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
    }
  }, [isVimCommandLineVisible, vimCommandLineInitialCommand]);

  const handleClose = () => {
    setVimCommandLine(false);
    if (editorRef?.current) {
      editorRef.current.focus();
    }
  };

  const handleExecuteCommand = () => {
    if (vimEngine && command.trim()) {
      vimEngine.executeExCommand(command, editorRef?.current, value);
    }
    handleClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleExecuteCommand();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  };

  if (!vimEnabled || !isVimCommandLineVisible) return null;

  return (
    <div className="absolute right-0 bottom-0 left-0 z-50 border-border border-t bg-primary-bg">
      <div className="flex items-center p-2">
        <span className="mr-1 font-mono text-text">:</span>
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent font-mono text-text outline-none"
          placeholder="Enter vim command..."
        />
      </div>
    </div>
  );
}
