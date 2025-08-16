import type React from "react";
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/settings/store";

export const FileTreeSettings = () => {
  const { settings, updateSetting } = useSettingsStore();

  const [filePatternsInput, setFilePatternsInput] = useState(
    settings.hiddenFilePatterns.join(", "),
  );
  const [directoryPatternsInput, setDirectoryPatternsInput] = useState(
    settings.hiddenDirectoryPatterns.join(", "),
  );

  useEffect(() => {
    setFilePatternsInput(settings.hiddenFilePatterns.join(", "));
  }, [settings.hiddenFilePatterns]);

  useEffect(() => {
    setDirectoryPatternsInput(settings.hiddenDirectoryPatterns.join(", "));
  }, [settings.hiddenDirectoryPatterns]);

  const handleFilePatternsChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFilePatternsInput(e.target.value);
  };

  const handleDirectoryPatternsChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDirectoryPatternsInput(e.target.value);
  };

  const handleFilePatternsBlur = () => {
    const patterns = filePatternsInput
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    updateSetting("hiddenFilePatterns", patterns);
  };

  const handleDirectoryPatternsBlur = () => {
    const patterns = directoryPatternsInput
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    updateSetting("hiddenDirectoryPatterns", patterns);
  };

  return (
    <div className="space-y-6">
      <h3 className="font-medium text-lg text-text">File Tree Settings</h3>

      <div>
        <label htmlFor="hiddenFilePatterns" className="mb-1 block font-medium text-sm text-text">
          Hidden File Patterns (comma-separated glob patterns)
        </label>
        <textarea
          id="hiddenFilePatterns"
          rows={4}
          className="w-full rounded border border-border bg-input-bg p-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={filePatternsInput}
          onChange={handleFilePatternsChange}
          onBlur={handleFilePatternsBlur}
          placeholder="e.g., *.log, *.tmp, **/*.bak"
        />
        <p className="mt-1 text-text-lighter text-xs">
          Files matching these glob patterns will be hidden from the file tree.
        </p>
      </div>

      <div>
        <label
          htmlFor="hiddenDirectoryPatterns"
          className="mb-1 block font-medium text-sm text-text"
        >
          Hidden Directory Patterns (comma-separated glob patterns)
        </label>
        <textarea
          id="hiddenDirectoryPatterns"
          rows={4}
          className="w-full rounded border border-border bg-input-bg p-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={directoryPatternsInput}
          onChange={handleDirectoryPatternsChange}
          onBlur={handleDirectoryPatternsBlur}
          placeholder="e.g., node_modules, .git, build/"
        />
        <p className="mt-1 text-text-lighter text-xs">
          Directories matching these glob patterns will be hidden from the file tree.
        </p>
      </div>
    </div>
  );
};
