import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import type { MenuItem } from "@/ui/dropdown";
import { FolderOpenIcon, RemoteIcon } from "@/ui/icons";

/** Opening a local project or adding a remote, for the Projects menus. */
export function useAddProjectItems(): MenuItem[] {
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const openProjectPicker = useUIState((state) => state.openProjectPicker);
  return [
    {
      id: "open-project",
      label: "Open project…",
      icon: <FolderOpenIcon />,
      onClick: () => void handleOpenFolder(),
    },
    {
      id: "add-remote",
      label: "Add remote…",
      icon: <RemoteIcon />,
      onClick: () => openProjectPicker("addRemote"),
    },
  ];
}
