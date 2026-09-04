import type { ActivityNavigationItem } from "@/features/layout/hooks/use-activity-navigation-items";
import type { CoreFeaturesState } from "@/features/settings/types/feature.types";
import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/ui/context-menu";
import {
  EyeIcon,
  ExtensionsIcon,
  FolderIcon,
  FolderOpenIcon,
  MagnifyingGlassIcon,
  NodesIcon,
  SparkleIcon,
  TerminalWindowIcon,
} from "@/ui/icons";

interface ActivityBarMenuProps {
  navigationItems: ActivityNavigationItem[];
  visibleNavigationItemIds: string[];
  coreFeatures: CoreFeaturesState;
  showAgentHistory: boolean;
  showTerminals: boolean;
  showProjectDots: boolean;
  hasHiddenItems: boolean;
  onNewAgent: () => void;
  onNewTerminal: () => void;
  onNewWorktree: () => void;
  onOpenProject: () => void;
  onSearch: () => void;
  onOpenExtensions: () => void;
  onNavigationItemVisibleChange: (itemId: string, visible: boolean) => void;
  onAgentHistoryVisibleChange: (visible: boolean) => void;
  onTerminalsVisibleChange: (visible: boolean) => void;
  onProjectDotsVisibleChange: (visible: boolean) => void;
  onShowAll: () => void;
}

export function ActivityBarMenu({
  navigationItems,
  visibleNavigationItemIds,
  coreFeatures,
  showAgentHistory,
  showTerminals,
  showProjectDots,
  hasHiddenItems,
  onNewAgent,
  onNewTerminal,
  onNewWorktree,
  onOpenProject,
  onSearch,
  onOpenExtensions,
  onNavigationItemVisibleChange,
  onAgentHistoryVisibleChange,
  onTerminalsVisibleChange,
  onProjectDotsVisibleChange,
  onShowAll,
}: ActivityBarMenuProps) {
  return (
    <ContextMenuContent>
      <ContextMenuGroup>
        <ContextMenuItem onClick={onNewAgent}>
          <SparkleIcon />
          New Agent
        </ContextMenuItem>
        {coreFeatures.terminal ? (
          <ContextMenuItem onClick={onNewTerminal}>
            <TerminalWindowIcon />
            New Terminal
          </ContextMenuItem>
        ) : null}
        {coreFeatures.git ? (
          <ContextMenuItem onClick={onNewWorktree}>
            <NodesIcon />
            New Worktree
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onClick={onOpenProject}>
          <FolderOpenIcon />
          Open Project…
        </ContextMenuItem>
        <ContextMenuItem onClick={onSearch}>
          <MagnifyingGlassIcon />
          Search
        </ContextMenuItem>
        <ContextMenuItem onClick={onOpenExtensions}>
          <ExtensionsIcon />
          Extensions
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <EyeIcon />
          Visible Items
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuGroup>
            {navigationItems.map((item) => (
              <ContextMenuCheckboxItem
                key={item.id}
                checked={visibleNavigationItemIds.includes(item.id)}
                onCheckedChange={(checked) => onNavigationItemVisibleChange(item.id, checked)}
              >
                {item.icon}
                {item.label}
              </ContextMenuCheckboxItem>
            ))}
            <ContextMenuCheckboxItem
              checked={showAgentHistory}
              onCheckedChange={onAgentHistoryVisibleChange}
            >
              <SparkleIcon />
              Agents
            </ContextMenuCheckboxItem>
            {coreFeatures.terminal ? (
              <ContextMenuCheckboxItem
                checked={showTerminals}
                onCheckedChange={onTerminalsVisibleChange}
              >
                <TerminalWindowIcon />
                Terminals
              </ContextMenuCheckboxItem>
            ) : null}
            <ContextMenuCheckboxItem
              checked={showProjectDots}
              onCheckedChange={onProjectDotsVisibleChange}
            >
              <FolderIcon />
              Project Dots
            </ContextMenuCheckboxItem>
          </ContextMenuGroup>
          {hasHiddenItems ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onShowAll}>
                <EyeIcon />
                Show All
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuSubContent>
      </ContextMenuSub>
    </ContextMenuContent>
  );
}
