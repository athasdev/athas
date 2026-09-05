import {
  ArchiveIcon as Archive,
  DownloadIcon as Download,
  TrashIcon as Trash,
  UploadIcon as Upload,
} from "@/ui/icons";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/ui/dropdown";
import { EmptyState } from "@/ui/empty";
import { SidebarListMenuItem, SidebarScrollArea } from "@/ui/sidebar";
import { formatRelativeDate } from "@/utils/date";
import type { GitStash } from "../types/git.types";
import { getStashDisplayTitle, getStashPositionLabel } from "../utils/git-stash-format";

interface GitStashManagerProps {
  stashes: GitStash[];
  query: string;
  isActionLoading: (stashIndex: number) => boolean;
  onView: (stashIndex: number) => void;
  onApply: (stashIndex: number) => void;
  onPop: (stashIndex: number) => void;
  onDrop: (stashIndex: number) => void;
}

export function GitStashManager({
  stashes,
  query,
  isActionLoading,
  onView,
  onApply,
  onPop,
  onDrop,
}: GitStashManagerProps) {
  if (stashes.length === 0) {
    return (
      <EmptyState layout="sidebar" title={query.trim() ? "No matching stashes" : "No stashes"} />
    );
  }

  return (
    <SidebarScrollArea className="min-h-0 flex-1">
      {stashes.map((stash) => {
        const title = getStashDisplayTitle(stash.message);
        const loading = isActionLoading(stash.index);

        return (
          <SidebarListMenuItem
            key={stash.index}
            leading={<Archive />}
            description={`${formatRelativeDate(stash.date)} · ${getStashPositionLabel(stash.index)}`}
            disabled={loading}
            onClick={() => onView(stash.index)}
            menuLabel={`Actions for ${title}`}
            menu={
              <>
                <DropdownMenuItem disabled={loading} onClick={() => onApply(stash.index)}>
                  <Download weight="fill" />
                  Apply stash
                </DropdownMenuItem>
                <DropdownMenuItem disabled={loading} onClick={() => onPop(stash.index)}>
                  <Upload />
                  Pop stash
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={loading}
                  onClick={() => onDrop(stash.index)}
                >
                  <Trash />
                  Drop stash
                </DropdownMenuItem>
              </>
            }
          >
            {title}
          </SidebarListMenuItem>
        );
      })}
    </SidebarScrollArea>
  );
}
