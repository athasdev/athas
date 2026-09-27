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
  ExtensionsIcon,
  EyeIcon,
  FolderOpenIcon,
  NodesIcon,
  SearchIcon,
  SparkleIcon,
  TerminalWindowIcon,
} from "@/ui/icons";

interface ActivityBarMenuProps {
  navigationItems: ActivityNavigationItem[];
  visibleNavigationItemIds: string[];
  coreFeatures: CoreFeaturesState;
  hasHiddenItems: boolean;
  onNewAgent: () => void;
  onNewTerminal: () => void;
  onNewWorktree: () => void;
  onOpenProject: () => void;
  onSearch: () => void;
  onOpenExtensions: () => void;
  onNavigationItemVisibleChange: (itemId: string, visible: boolean) => void;
  onShowAll: () => void;
}

export function ActivityBarMenu({
  navigationItems,
  visibleNavigationItemIds,
  coreFeatures,
  hasHiddenItems,
  onNewAgent,
  onNewTerminal,
  onNewWorktree,
  onOpenProject,
  onSearch,
  onOpenExtensions,
  onNavigationItemVisibleChange,
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
          <SearchIcon />
          Search
        </ContextMenuItem>
        <ContextMenuItem onClick={onOpenExtensions}>
          <ExtensionsIcon />
          Integrations
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
