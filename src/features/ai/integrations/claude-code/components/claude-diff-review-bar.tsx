import { Button } from "@/ui/button";
import { CheckIcon, GitDiffIcon, XIcon } from "@/ui/icons";
import { PaneContentHeader } from "@/ui/pane-content-chrome";
import { toRelativeDisplayPath } from "@/features/ai/lib/acp-diff-output";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import {
  acceptClaudeDiff,
  rejectClaudeDiff,
  useClaudeDiffReviewStore,
} from "../services/claude-ide-diff-review";

interface ClaudeDiffReviewBarProps {
  bufferId: string;
}

export function ClaudeDiffReviewBar({ bufferId }: ClaudeDiffReviewBarProps) {
  const review = useClaudeDiffReviewStore((state) => state.reviews[bufferId]);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  if (!review) return null;

  return (
    <PaneContentHeader
      leading={<GitDiffIcon />}
      title="Claude Code proposes changes"
      detail={toRelativeDisplayPath(review.filePath, rootFolderPath)}
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            tone="danger"
            onClick={() => rejectClaudeDiff(bufferId)}
          >
            <XIcon />
            Reject
          </Button>
          <Button
            type="button"
            variant="ghost"
            tone="success"
            onClick={() => acceptClaudeDiff(bufferId)}
          >
            <CheckIcon />
            Accept
          </Button>
        </>
      }
    />
  );
}
