import { useEffect, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import Section, { SettingRow } from "@/ui/section";
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
      <Section title="File Tree Settings">
        <SettingRow
          label="Hidden File Patterns"
          description="Files matching these glob patterns will be hidden from the file tree"
          className="flex-col items-start gap-2"
        >
          <Textarea
            id="hiddenFilePatterns"
            rows={3}
            value={filePatternsInput}
            onChange={handleFilePatternsChange}
            onBlur={handleFilePatternsBlur}
            placeholder="e.g., *.log, *.tmp, **/*.bak"
            size="sm"
            className="w-full"
          />
        </SettingRow>

        <SettingRow
          label="Hidden Directory Patterns"
          description="Directories matching these glob patterns will be hidden from the file tree"
          className="flex-col items-start gap-2"
        >
          <Textarea
            id="hiddenDirectoryPatterns"
            rows={3}
            value={directoryPatternsInput}
            onChange={handleDirectoryPatternsChange}
            onBlur={handleDirectoryPatternsBlur}
            placeholder="e.g., node_modules, .git, build/"
            size="sm"
            className="w-full"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
