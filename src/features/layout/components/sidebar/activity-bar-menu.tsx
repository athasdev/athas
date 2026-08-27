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
  TerminalIcon,
} from "@/ui/icons";

interface ActivityBarMenuProps {
  navigationItems: ActivityNavigationItem[];
  hiddenNavigationItemIds: string[];
  coreFeatures: CoreFeaturesState;
  showProjectSwitcher: boolean;
  showAgentHistory: boolean;
  showTerminals: boolean;
  showWorktrees: boolean;
  showProjectDots: boolean;
  hasHiddenItems: boolean;
  onNewAgent: () => void;
  onNewTerminal: () => void;
  onNewWorktree: () => void;
  onOpenProject: () => void;
  onSearch: () => void;
  onOpenExtensions: () => void;
  onNavigationItemVisibleChange: (itemId: string, visible: boolean) => void;
  onProjectSwitcherVisibleChange: (visible: boolean) => void;
  onAgentHistoryVisibleChange: (visible: boolean) => void;
  onTerminalsVisibleChange: (visible: boolean) => void;
  onWorktreesVisibleChange: (visible: boolean) => void;
  onProjectDotsVisibleChange: (visible: boolean) => void;
  onShowAll: () => void;
}

export function ActivityBarMenu({
  navigationItems,
  hiddenNavigationItemIds,
  coreFeatures,
  showProjectSwitcher,
  showAgentHistory,
  showTerminals,
  showWorktrees,
  showProjectDots,
  hasHiddenItems,
  onNewAgent,
  onNewTerminal,
  onNewWorktree,
  onOpenProject,
  onSearch,
  onOpenExtensions,
  onNavigationItemVisibleChange,
  onProjectSwitcherVisibleChange,
  onAgentHistoryVisibleChange,
  onTerminalsVisibleChange,
  onWorktreesVisibleChange,
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
            <TerminalIcon />
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
            <ContextMenuCheckboxItem
              checked={showProjectSwitcher}
              onCheckedChange={onProjectSwitcherVisibleChange}
            >
              <FolderIcon />
              Project Switcher
            </ContextMenuCheckboxItem>
            {navigationItems.map((item) => (
              <ContextMenuCheckboxItem
                key={item.id}
                checked={!hiddenNavigationItemIds.includes(item.id)}
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
                <TerminalIcon />
                Terminals
              </ContextMenuCheckboxItem>
            ) : null}
            {coreFeatures.git ? (
              <ContextMenuCheckboxItem
                checked={showWorktrees}
                onCheckedChange={onWorktreesVisibleChange}
              >
                <NodesIcon />
                Worktrees
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
