import type React from "react";
import { ArrowLeft } from "lucide-react";
import { useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { logger } from "@/features/editor/utils/logger";
import { readDirectory } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { FileEntry } from "@/features/file-system/types/app";
import { Button } from "@/ui/button";
import { Dropdown, dropdownItemClassName } from "@/ui/dropdown";
import { PathBreadcrumb } from "./path-breadcrumb";

interface DirectoryEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface FilePathBreadcrumbProps {
  filePath: string;
  interactive?: boolean;
  className?: string;
}

export function FilePathBreadcrumb({
  filePath,
  interactive = true,
  className,
}: FilePathBreadcrumbProps) {
  const { rootFolderPath, handleFileSelect } = useFileSystemStore();
  const [dropdown, setDropdown] = useState<{
    segmentIndex: number;
    x: number;
    y: number;
    items: FileEntry[];
    currentPath: string;
    navigationStack: string[];
  } | null>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const getPathSegments = () => {
    if (!filePath) return [];

    if (filePath.startsWith("remote://")) {
      const pathWithoutRemote = filePath.replace(/^remote:\/\/[^/]+/, "");
      return pathWithoutRemote.split("/").filter(Boolean);
    }

    if (filePath.includes("://")) {
      return [filePath.split("://")[1] || filePath];
    }

    if (rootFolderPath && filePath.startsWith(rootFolderPath)) {
      const relativePath = filePath.slice(rootFolderPath.length);
      return relativePath.split("/").filter(Boolean);
    }

    return filePath.split("/").filter(Boolean);
  };

  const segments = getPathSegments();

  const handleNavigate = async (path: string) => {
    try {
      await handleFileSelect(path, false);
    } catch (error) {
      logger.error("Editor", "Failed to navigate to path:", path, error);
    }
  };

  const loadDirectoryEntries = async (path: string) => {
    const entries = await readDirectory(path);
    const fileEntries: FileEntry[] = entries.map((entry: DirectoryEntry) => ({
      name: entry.name || "Unknown",
      path: entry.path,
      isDir: entry.is_dir || false,
      children: undefined,
    }));

    fileEntries.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    return fileEntries;
  };

  const handleGoBack = async () => {
    if (!dropdown || dropdown.navigationStack.length === 0) return;

    const previousPath = dropdown.navigationStack[dropdown.navigationStack.length - 1];

    try {
      const items = await loadDirectoryEntries(previousPath);
      setDropdown((prev) =>
        prev
          ? {
              ...prev,
              items,
              currentPath: previousPath,
              navigationStack: prev.navigationStack.slice(0, -1),
            }
          : null,
      );
    } catch (error) {
      logger.error("Editor", "Failed to go back:", error);
    }
  };

  const handleSegmentClick = async (
    segmentIndex: number,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (segmentIndex === segments.length - 1) {
      const fullPath = rootFolderPath
        ? `${rootFolderPath}/${segments.slice(0, segmentIndex + 1).join("/")}`
        : segments.slice(0, segmentIndex + 1).join("/");
      await handleNavigate(fullPath);
      return;
    }

    if (dropdown && dropdown.segmentIndex === segmentIndex) {
      setDropdown(null);
      return;
    }

    const dirPath = rootFolderPath
      ? `${rootFolderPath}/${segments.slice(0, segmentIndex + 1).join("/")}`
      : segments.slice(0, segmentIndex + 1).join("/");

    try {
      const items = await loadDirectoryEntries(dirPath);
      const button = buttonRefs.current[segmentIndex];

      if (!button) return;

      const rect = button.getBoundingClientRect();
      setDropdown({
        segmentIndex,
        x: rect.left,
        y: rect.bottom + 2,
        items,
        currentPath: dirPath,
        navigationStack: [],
      });
    } catch (error) {
      logger.error("Editor", "Failed to load directory contents:", error);
    }
  };

  if (segments.length === 0) return null;

  return (
    <>
      <PathBreadcrumb
        segments={segments}
        fullPath={filePath}
        interactive={interactive}
        onSegmentClick={interactive ? handleSegmentClick : undefined}
        setSegmentRef={
          interactive
            ? (index, element) => {
                buttonRefs.current[index] = element;
              }
            : undefined
        }
        className={className}
      />

      {interactive && dropdown && (
        <Dropdown
          isOpen={Boolean(dropdown)}
          point={{ x: dropdown.x, y: dropdown.y }}
          onClose={() => setDropdown(null)}
          className="breadcrumb-dropdown min-w-0"
          style={{
            zIndex: EDITOR_CONSTANTS.Z_INDEX.DROPDOWN,
            maxHeight: `${EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT}px`,
            minWidth: `${EDITOR_CONSTANTS.DROPDOWN_MIN_WIDTH}px`,
          }}
        >
          {dropdown.navigationStack.length > 0 && (
            <Button
              onClick={handleGoBack}
              variant="ghost"
              size="sm"
              className={dropdownItemClassName(
                "justify-start border-border/70 border-b text-text-lighter hover:text-text",
              )}
            >
              <ArrowLeft className="shrink-0" />
              <span>Go back</span>
            </Button>
          )}

          {dropdown.items.map((item) => (
            <Button
              key={item.path}
              onClick={async () => {
                if (item.isDir) {
                  try {
                    const items = await loadDirectoryEntries(item.path);
                    setDropdown((prev) =>
                      prev
                        ? {
                            ...prev,
                            items,
                            currentPath: item.path,
                            navigationStack: [...prev.navigationStack, prev.currentPath],
                          }
                        : null,
                    );
                  } catch (error) {
                    logger.error("Editor", "Failed to load folder contents:", error);
                  }
                } else {
                  await handleNavigate(item.path);
                  setDropdown(null);
                }
              }}
              variant="ghost"
              size="sm"
              className={dropdownItemClassName("justify-start")}
            >
              <PathBreadcrumb
                segments={[item.name]}
                fullPath={item.path}
                className="overflow-hidden"
              />
            </Button>
          ))}
        </Dropdown>
      )}
    </>
  );
}
