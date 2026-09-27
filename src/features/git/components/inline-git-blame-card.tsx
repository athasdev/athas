import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { CheckIcon, CopyIcon } from "@/ui/icons";
import { Popover, PopoverContent } from "@/ui/popover";
import { writeClipboardText } from "@/utils/clipboard";
import { getGitAuthorAvatarUrl } from "../utils/git-author-avatar";
import type { InlineGitBlamePresentation } from "../utils/git-blame-decoration";

interface InlineGitBlameCardProps {
  anchor: HTMLElement;
  presentation: InlineGitBlamePresentation;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

export function InlineGitBlameCard({
  anchor,
  presentation,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: InlineGitBlameCardProps) {
  const account = useAuthStore((state) => state.user);
  const [copied, setCopied] = useState(false);
  const avatarUrl = getGitAuthorAvatarUrl({ email: presentation.email ?? undefined }, account);

  useEffect(() => {
    setCopied(false);
  }, [presentation.commitHash]);

  const copyCommitHash = async () => {
    try {
      await writeClipboardText(presentation.commitHash);
      setCopied(true);
    } catch (error) {
      toast.error(`Failed to copy commit hash: ${String(error)}`);
    }
  };

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverContent
        anchor={anchor}
        initialFocus={false}
        finalFocus={false}
        side="top"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        size="default"
        className="gap-1.5 p-2.5"
        onMouseEnter={onPointerEnter}
        onMouseLeave={onPointerLeave}
      >
        <div className="flex min-w-0 items-center gap-1.5 text-subtle-foreground ui-text-sm">
          <Avatar name={presentation.author} src={avatarUrl} size="sm" />
          <span
            className="min-w-0 truncate select-text font-medium text-foreground"
            title={presentation.email ?? undefined}
          >
            {presentation.author}
          </span>
          <span className="shrink-0">{presentation.relativeTime}</span>
        </div>
        <p className="line-clamp-3 select-text text-foreground ui-text-sm">
          {presentation.commitSummary}
        </p>
        <div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            tooltip={copied ? "Copied" : "Copy commit hash"}
            aria-label={
              copied ? "Commit hash copied" : `Copy commit hash ${presentation.shortHash}`
            }
            onClick={() => void copyCommitHash()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span className="font-mono">{presentation.shortHash}</span>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
