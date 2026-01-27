import { cn } from "@/utils/cn";
import type { GitFile } from "../../types/git";

interface GitStatusDotProps {
  status: GitFile["status"];
  className?: string;
}

const statusColors: Record<GitFile["status"], string> = {
  added: "bg-git-added",
  deleted: "bg-git-deleted",
  modified: "bg-git-modified",
  untracked: "bg-git-untracked",
  renamed: "bg-git-renamed",
};

export const GitStatusDot = ({ status, className }: GitStatusDotProps) => (
  <div
    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusColors[status], className)}
    title={status}
  />
);
