import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useMemo, useState } from "react";
import {
  createThemeFileFromBase,
  formatThemeFile,
  parseThemeFileJson,
  ThemeFileValidationError,
} from "@/extensions/themes/theme-file";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { ThemeDefinition } from "@/extensions/themes/theme.types";
import { installThemeJson } from "@/features/settings/utils/theme-upload";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { BracketsCurlyIcon } from "@/ui/icons";
import Input from "@/ui/input";
import Select from "@/ui/select";
import Textarea from "@/ui/textarea";
import { toast } from "@/ui/toast";

interface CustomThemeCreatorDialogProps {
  baseThemeId: string;
  themes: ThemeDefinition[];
  onClose: () => void;
  onInstalled: (themeId: string) => void;
}

function themeIdFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatIssues(error: unknown): string[] {
  if (error instanceof ThemeFileValidationError) return error.issues;
  return [error instanceof Error ? error.message : "Failed to generate the theme file."];
}

export function CustomThemeCreatorDialog({
  baseThemeId,
  themes,
  onClose,
  onInstalled,
}: CustomThemeCreatorDialogProps) {
  const fallbackTheme = themes[0];
  const initialBaseTheme = themeRegistry.getTheme(baseThemeId) ?? fallbackTheme;
  const [name, setName] = useState("My Athas Theme");
  const [id, setId] = useState("my-athas-theme");
  const [idEdited, setIdEdited] = useState(false);
  const [selectedBaseThemeId, setSelectedBaseThemeId] = useState(
    initialBaseTheme?.id ?? baseThemeId,
  );
  const [manualJson, setManualJson] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const selectedBaseTheme =
    themeRegistry.getTheme(selectedBaseThemeId) ?? initialBaseTheme ?? fallbackTheme;
  const generatedJson = useMemo(() => {
    if (!selectedBaseTheme) return "";
    return formatThemeFile(
      createThemeFileFromBase({
        id,
        name,
        baseTheme: selectedBaseTheme,
      }),
    );
  }, [id, name, selectedBaseTheme]);
  const json = manualJson ?? generatedJson;
  const themeOptions = themes.map((theme) => ({ value: theme.id, label: theme.name }));

  const validateJson = () => {
    try {
      const themeFile = parseThemeFileJson(json);
      setIssues([]);
      return themeFile;
    } catch (error) {
      setIssues(formatIssues(error));
      return null;
    }
  };

  const handleInstall = async () => {
    if (!validateJson()) return;
    setIsInstalling(true);
    const result = await installThemeJson(json);
    setIsInstalling(false);

    if (!result.success || !result.theme) {
      setIssues(result.details ?? [result.error ?? "Failed to install the theme."]);
      return;
    }

    toast.success(
      result.themes?.length === 1
        ? `Installed ${result.theme.name}`
        : `Installed ${result.themes?.length ?? 0} theme variants`,
    );
    onInstalled(result.theme.id);
    onClose();
  };

  const handleSave = async () => {
    const themeFile = validateJson();
    if (!themeFile) return;

    setIsSaving(true);
    try {
      const targetPath = await save({
        defaultPath: `${themeFile.themes[0]?.id || "athas-theme"}.json`,
        filters: [
          { name: "Athas theme", extensions: ["json"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (!targetPath) return;

      await writeTextFile(targetPath, formatThemeFile(themeFile));
      toast.success("Theme JSON saved");
    } catch (error) {
      toast.error("Failed to save theme JSON", formatIssues(error)[0]);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      title="Create Theme"
      icon={BracketsCurlyIcon}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={() => void handleSave()}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save JSON"}
          </Button>
          <Button
            type="button"
            variant="accent"
            onClick={() => void handleInstall()}
            disabled={isInstalling}
          >
            {isInstalling ? "Installing..." : "Install Theme"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="font-sans ui-text-sm text-text-lighter">
          Start from an installed theme, then edit the generated JSON before saving or installing
          it.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 font-sans ui-text-sm text-text">
            <span>Name</span>
            <Input
              value={name}
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                if (!idEdited) setId(themeIdFromName(nextName));
                setManualJson(null);
              }}
              aria-label="Theme name"
            />
          </label>
          <label className="space-y-1 font-sans ui-text-sm text-text">
            <span>ID</span>
            <Input
              value={id}
              onChange={(event) => {
                setId(event.target.value);
                setIdEdited(true);
                setManualJson(null);
              }}
              aria-label="Theme ID"
            />
          </label>
        </div>

        <label className="space-y-1 font-sans ui-text-sm text-text">
          <span>Base theme</span>
          <Select
            value={selectedBaseThemeId}
            options={themeOptions}
            onChange={(value) => {
              setSelectedBaseThemeId(value);
              setManualJson(null);
            }}
            searchable
            searchableTrigger="input"
            aria-label="Base theme"
          />
        </label>

        <label className="space-y-1 font-sans ui-text-sm text-text">
          <span>Theme JSON</span>
          <Textarea
            value={json}
            onChange={(event) => {
              setManualJson(event.target.value);
              setIssues([]);
            }}
            className="min-h-72 resize-y font-mono"
            aria-label="Theme JSON"
          />
        </label>

        {issues.length > 0 ? (
          <div className="rounded-lg bg-error/10 px-3 py-2 text-error" role="alert">
            <p className="font-sans ui-text-sm font-medium">Fix these theme file issues:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 font-sans ui-text-sm">
              {issues.slice(0, 8).map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
