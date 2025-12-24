import { useEffect, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import Section from "@/ui/section";
import Textarea from "@/ui/textarea";

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
    <div className="space-y-4">
      <Section title="Hidden File Patterns" description="Comma-separated glob patterns">
        <div className="flex flex-col gap-2">
          <Textarea
            id="hiddenFilePatterns"
            rows={4}
            value={filePatternsInput}
            onChange={handleFilePatternsChange}
            onBlur={handleFilePatternsBlur}
            placeholder="e.g., *.log, *.tmp, **/*.bak"
            size="sm"
          />
          <p className="text-text-lighter text-xs">
            Files matching these glob patterns will be hidden from the file tree.
          </p>
        </div>
      </Section>

      <Section title="Hidden Directory Patterns" description="Comma-separated glob patterns">
        <div className="flex flex-col gap-2">
          <Textarea
            id="hiddenDirectoryPatterns"
            rows={4}
            value={directoryPatternsInput}
            onChange={handleDirectoryPatternsChange}
            onBlur={handleDirectoryPatternsBlur}
            placeholder="e.g., node_modules, .git, build/"
            size="sm"
          />
          <p className="text-text-lighter text-xs">
            Directories matching these glob patterns will be hidden from the file tree.
          </p>
        </div>
      </Section>
    </div>
  );
};
