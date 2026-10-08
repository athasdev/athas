import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { cn } from "@/utils/cn";
import type { GitFile } from "../types/git.types";

const STATUS_META: Record<GitFile["status"], { letter: string; label: string; className: string }> =
  {
    modified: { letter: "M", label: "Modified", className: "text-git-modified bg-git-modified/15" },
    added: { letter: "A", label: "Added", className: "text-git-added bg-git-added/15" },
    deleted: { letter: "D", label: "Deleted", className: "text-git-deleted bg-git-deleted/15" },
    untracked: {
      letter: "U",
      label: "Untracked",
      className: "text-git-untracked bg-git-untracked/15",
    },
    renamed: { letter: "R", label: "Renamed", className: "text-git-renamed bg-git-renamed/15" },
  };

export function StatusLetter({ status }: { status: GitFile["status"] }) {
  const meta = STATUS_META[status];
  return (
    <span
      title={meta.label}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-md font-mono ui-text-caption font-semibold",
        meta.className,
      )}
    >
      {meta.letter}
    </span>
  );
}

export function FileGlyph({ name }: { name: string }) {
  return (
    <ThemedFileIcon
      fileName={name}
      isDir={false}
      className="size-3.5 shrink-0 text-subtle-foreground"
    />
  );
}

export function DiffNumbers({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className="flex shrink-0 gap-1 font-mono ui-text-caption tabular-nums">
      {additions > 0 ? <span className="text-git-added">+{additions}</span> : null}
      {deletions > 0 ? <span className="text-git-deleted">−{deletions}</span> : null}
    </span>
  );
}

export function shortHash(hash: string) {
  return hash.slice(0, 7);
}
