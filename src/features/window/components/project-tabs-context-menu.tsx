import { Copy, FolderOpen, X } from "lucide-react";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs-store";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";

interface ProjectTabsContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  tab: ProjectTab | null;
  totalTabs: number;
  onClose: () => void;
  onCloseProject: (projectId: string) => void;
  onCloseOthers: (projectId: string) => void;
  onCloseToRight: (projectId: string) => void;
  onCloseAll: () => void;
  onCopyPath: (path: string) => void;
  onRevealInFinder: (path: string) => void;
}

const ProjectTabsContextMenu = ({
  isOpen,
  position,
  tab,
  totalTabs,
  onClose,
  onCloseProject,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onCopyPath,
  onRevealInFinder,
}: ProjectTabsContextMenuProps) => {
  if (!isOpen || !tab) return null;

  const items: ContextMenuItem[] = [
    {
      id: "copy-path",
      label: "Copy Path",
      icon: <Copy />,
      onClick: () => onCopyPath(tab.path),
    },
    {
      id: "reveal",
      label: "Reveal in Finder",
      icon: <FolderOpen />,
      onClick: () => onRevealInFinder(tab.path),
    },
    { id: "sep-1", label: "", separator: true, onClick: () => {} },
    ...(totalTabs > 1
      ? [
          {
            id: "close-project",
            label: "Close Project",
            icon: <X />,
            onClick: () => onCloseProject(tab.id),
          },
        ]
      : []),
    {
      id: "close-others",
      label: "Close Other Projects",
      onClick: () => onCloseOthers(tab.id),
    },
    {
      id: "close-right",
      label: "Close to Right",
      onClick: () => onCloseToRight(tab.id),
    },
    ...(totalTabs > 1
      ? [
          {
            id: "close-all",
            label: "Close All Projects",
            onClick: onCloseAll,
          },
        ]
      : []),
  ];

  return <ContextMenu isOpen={isOpen} position={position} items={items} onClose={onClose} />;
};

export default ProjectTabsContextMenu;
