import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { CheckIcon as Check, CopyIcon as Copy } from "@/ui/icons";
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
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="w-80 gap-0 overflow-hidden p-0"
        onMouseEnter={onPointerEnter}
        onMouseLeave={onPointerLeave}
      >
        <div className="flex min-w-0 items-start gap-2.5 p-3">
          <Avatar name={presentation.author} src={avatarUrl} className="size-8" />
          <div className="min-w-0 flex-1">
            <div className="select-text font-medium leading-snug text-foreground ui-text-base">
              {presentation.commitSummary}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-subtle-foreground ui-text-sm">
              <span className="truncate select-text">{presentation.author}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{presentation.relativeTime}</span>
            </div>
            {presentation.email ? (
              <div className="mt-0.5 truncate select-text text-subtle-foreground ui-text-sm">
                {presentation.email}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between border-border/70 border-t bg-surface/55 px-3 py-1.5">
          <code
            className="select-text font-mono text-subtle-foreground ui-text-sm"
            title={presentation.commitHash}
          >
            {presentation.shortHash}
          </code>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            tooltip={copied ? "Copied commit hash" : "Copy commit hash"}
            aria-label={copied ? "Commit hash copied" : "Copy commit hash"}
            onClick={() => void copyCommitHash()}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
