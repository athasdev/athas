import { convertFileSrc } from "@tauri-apps/api/core";
import { readDir } from "@tauri-apps/plugin-fs";
import { Trash2 } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import Tooltip from "@/ui/tooltip";

function relativePath(fullPath: string, basePath: string): string {
  const normalized = fullPath.startsWith(basePath) ? fullPath.slice(basePath.length) : fullPath;
  return normalized.replace(/^[/\\]/, "");
}

interface ProjectIconPickerProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectPath: string;
}

interface IcoFile {
  name: string;
  path: string;
  src: string;
}

async function scanIcoFiles(projectPath: string): Promise<IcoFile[]> {
  const results: IcoFile[] = [];
  const separator = projectPath.includes("\\") ? "\\" : "/";

  async function scanDirectory(dirPath: string, depth: number) {
    if (depth > 3) return;

    try {
      const entries = await readDir(dirPath);

      for (const entry of entries) {
        const entryPath = `${dirPath}${separator}${entry.name}`;

        if (!entry.isDirectory && entry.name && /\.(ico|png|svg)$/i.test(entry.name)) {
          const isLikelyIcon =
            /\.(ico)$/i.test(entry.name) || /icon|logo|favicon/i.test(entry.name);

          if (isLikelyIcon) {
            results.push({
              name: entry.name,
              path: entryPath,
              src: convertFileSrc(entryPath),
            });
          }
        }

        if (
          entry.isDirectory &&
          entry.name &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules" &&
          entry.name !== "dist" &&
          entry.name !== "build" &&
          entry.name !== "target" &&
          entry.name !== "vendor"
        ) {
          await scanDirectory(entryPath, depth + 1);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await scanDirectory(projectPath, 0);
  return results;
}

const ProjectIconPicker = memo(
  ({ isOpen, onClose, projectId, projectPath }: ProjectIconPickerProps) => {
    const [icons, setIcons] = useState<IcoFile[]>([]);
    const [loading, setLoading] = useState(false);
    const { setProjectIcon } = useWorkspaceTabsStore.getState();
    const currentIcon = useWorkspaceTabsStore(
      (s) => s.projectTabs.find((t) => t.id === projectId)?.customIcon,
    );

    useEffect(() => {
      if (!isOpen) return;

      setLoading(true);
      scanIcoFiles(projectPath).then((found) => {
        setIcons(found);
        setLoading(false);
      });
    }, [isOpen, projectPath]);

    const handleSelect = useCallback(
      (iconPath: string) => {
        setProjectIcon(projectId, iconPath);
        onClose();
      },
      [projectId, onClose, setProjectIcon],
    );

    const handleRemoveIcon = useCallback(() => {
      setProjectIcon(projectId, undefined);
      onClose();
    }, [projectId, onClose, setProjectIcon]);

    if (!isOpen) return null;

    return (
      <Dialog
        title="Select project icon"
        onClose={onClose}
        size="sm"
        headerBorder={false}
        headerActions={
          currentIcon ? (
            <Tooltip content="Remove icon" side="bottom">
              <Button
                onClick={handleRemoveIcon}
                variant="ghost"
                size="icon-sm"
                aria-label="Remove custom icon"
              >
                <Trash2 />
              </Button>
            </Tooltip>
          ) : undefined
        }
        classNames={{
          modal: "max-w-[360px] rounded-xl",
          content: "p-3",
        }}
      >
        {loading ? (
          <div className="ui-text-sm py-6 text-center text-text-lighter">Scanning for icons...</div>
        ) : icons.length === 0 ? (
          <div className="ui-text-sm py-6 text-center text-text-lighter">
            No icon files found in this project.
            <br />
            <span className="ui-text-sm">
              Looks for .ico, icon/logo/favicon .png and .svg files
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-6 gap-1.5">
            {icons.map((icon) => (
              <Tooltip key={icon.path} content={relativePath(icon.path, projectPath)} side="bottom">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-md"
                  onClick={() => handleSelect(icon.path)}
                  className={`group size-12 border ${
                    currentIcon === icon.path ? "border-accent bg-accent/10" : "border-border/50"
                  }`}
                  aria-label={`Select ${icon.name} as project icon`}
                >
                  <img
                    src={icon.src}
                    alt={icon.name}
                    className="size-7 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </Button>
              </Tooltip>
            ))}
          </div>
        )}
      </Dialog>
    );
  },
);

ProjectIconPicker.displayName = "ProjectIconPicker";

export default ProjectIconPicker;
