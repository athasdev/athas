import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import { useRecentFoldersStore } from "@/features/file-system/stores/recent-folders.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import {
  getProjectIconOptions,
  scanProjectIconFiles,
  type ProjectIconFile,
} from "@/features/window/utils/project-icons";
import Command, {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandHeader,
  CommandInput,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
  CommandTabs,
  useCommandListNavigation,
} from "@/ui/command";
import { MagnifyingGlassIcon, TrashIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { ProjectCustomIcon } from "./project-custom-icon";
import {
  getProjectIconCategory,
  searchProjectSymbols,
  type ProjectIconCategory,
} from "../utils/project-symbols";

interface ProjectIconPickerProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectPath: string;
}

function ProjectIconPickerContent({
  onClose,
  projectId,
  projectPath,
}: Omit<ProjectIconPickerProps, "isOpen">) {
  const [icons, setIcons] = useState<ProjectIconFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const resultsRef = useRef<HTMLDivElement>(null);
  const resultsId = useId();
  const { setProjectIcon } = useWorkspaceTabsStore.use.actions();
  const currentIcon = useWorkspaceTabsStore(
    (state) => state.projectTabs.find((tab) => tab.id === projectId)?.customIcon,
  );
  const [category, setCategory] = useState<ProjectIconCategory>(() =>
    getProjectIconCategory(currentIcon),
  );
  const options = useMemo(
    () =>
      category === "files"
        ? getProjectIconOptions(icons, projectPath, query).map((icon) => ({
            value: icon.path,
            name: icon.name,
            description: icon.relativePath,
          }))
        : searchProjectSymbols(category, query).map((symbol) => ({
            value: symbol.value,
            name: symbol.name,
            description: undefined,
          })),
    [category, icons, projectPath, query],
  );

  useEffect(() => {
    let cancelled = false;
    void scanProjectIconFiles(projectPath)
      .then((found) => {
        if (!cancelled) setIcons(found);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const selectIcon = useCallback(
    (iconPath: string | undefined) => {
      setProjectIcon(projectId, iconPath);
      useRecentFoldersStore.getState().actions.updateRecentFolder(projectPath, {
        activeProjectTabId: projectId,
        customIcon: iconPath,
      });
      onClose();
    },
    [projectId, projectPath, onClose, setProjectIcon],
  );

  const { selectedIndex, setSelectedIndex, onInputKeyDown } = useCommandListNavigation({
    itemCount: options.length,
    resetKey: `${category}:${query}`,
    onSelect: (index) => {
      const option = options[index];
      if (option) selectIcon(option.value);
    },
  });

  useEffect(() => {
    resultsRef.current
      ?.querySelector(`[data-icon-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, options]);

  return (
    <Command isVisible title="Select project icon" onClose={onClose}>
      <CommandHeader onClose={onClose}>
        <MagnifyingGlassIcon className="size-4 shrink-0 text-subtle-foreground" />
        <CommandInput
          value={query}
          onChange={setQuery}
          onKeyDown={onInputKeyDown}
          placeholder="Search project icons…"
          aria-label="Search project icons"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={resultsId}
          aria-activedescendant={
            options[selectedIndex] ? `${resultsId}-${selectedIndex}` : undefined
          }
        />
      </CommandHeader>
      <CommandTabs
        ariaLabel="Project icon categories"
        items={(
          [
            { id: "files", label: "Project Files" },
            { id: "emojis", label: "Emojis" },
            { id: "icons", label: "Icons" },
          ] as const
        ).map((item) => ({
          ...item,
          isActive: category === item.id,
          onSelect: () => setCategory(item.id),
        }))}
      />
      <CommandList
        ref={resultsRef}
        id={resultsId}
        role="listbox"
        aria-label="Project icons"
        aria-busy={category === "files" && loading}
      >
        {category === "files" && loading ? (
          <CommandEmpty role="status">
            <Spinner label="Scanning for icons" showLabel compact />
          </CommandEmpty>
        ) : category === "files" && error ? (
          <CommandEmpty role="status">
            Could not scan project icons. Close and reopen to retry.
          </CommandEmpty>
        ) : options.length === 0 ? (
          <CommandEmpty role="status">
            {category === "files" && icons.length === 0
              ? "No icon files found in this project. Looks for icon, logo, and favicon .ico, .png, and .svg files."
              : "No icons match your search."}
          </CommandEmpty>
        ) : (
          options.map((icon, index) => (
            <CommandItemRow
              key={icon.value}
              as="div"
              id={`${resultsId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === selectedIndex}
              data-icon-index={index}
              isSelected={index === selectedIndex}
              onClick={() => selectIcon(icon.value)}
              onMouseEnter={() => setSelectedIndex(index)}
              icon={<ProjectCustomIcon value={icon.value} className="size-5" />}
              contentLayout="stacked"
              title={<SearchMatchHighlight text={icon.name} query={query} />}
              description={
                icon.description ? (
                  <SearchMatchHighlight text={icon.description} query={query} />
                ) : undefined
              }
              accessory={
                currentIcon === icon.value ? (
                  <CommandItemBadge>Current</CommandItemBadge>
                ) : undefined
              }
            />
          ))
        )}
      </CommandList>
      {currentIcon ? (
        <CommandFooter>
          <CommandFooterAction onClick={() => selectIcon(undefined)}>
            <TrashIcon /> Remove custom icon
          </CommandFooterAction>
        </CommandFooter>
      ) : null}
    </Command>
  );
}

const ProjectIconPicker = memo(({ isOpen, ...props }: ProjectIconPickerProps) =>
  isOpen ? (
    <ProjectIconPickerContent key={`${props.projectId}:${props.projectPath}`} {...props} />
  ) : null,
);

ProjectIconPicker.displayName = "ProjectIconPicker";
export default ProjectIconPicker;
