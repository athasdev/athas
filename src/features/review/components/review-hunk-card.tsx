import TextDiffViewer from "@/features/git/components/diff/git-diff-text";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/ui/card";
import {
  AiLoadingIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ChatCircleTextIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  EyeIcon,
  FileCodeIcon,
  LightbulbIcon,
  LightningIcon,
  ListChecksIcon,
  ShieldWarningIcon,
  SparkleIcon,
  WarningCircleIcon,
} from "@/ui/icons";
import { Kbd } from "@/ui/kbd";
import Textarea from "@/ui/textarea";
import { writeClipboardText } from "@/utils/clipboard";
import { toast } from "sonner";
import type { ReviewHunk } from "../lib/review-hunks";
import type {
  ReviewHunkInsight,
  ReviewHunkInsightKind,
  ReviewHunkSummary,
} from "../types/review.types";

const INSIGHT_ACTIONS: Array<{
  kind: ReviewHunkInsightKind;
  label: string;
  icon: typeof LightbulbIcon;
}> = [
  { kind: "explain", label: "Explain", icon: LightbulbIcon },
  { kind: "risks", label: "Find risks", icon: ShieldWarningIcon },
  { kind: "tests", label: "Suggest tests", icon: ListChecksIcon },
  { kind: "comment", label: "Draft comment", icon: ChatCircleTextIcon },
];

interface ReviewHunkCardProps {
  hunk: ReviewHunk;
  summary: ReviewHunkSummary;
  current: number;
  total: number;
  isSummarizing: boolean;
  isReviewed: boolean;
  needsAttention: boolean;
  streak: number;
  activeInsightKind: ReviewHunkInsightKind | null;
  insight: ReviewHunkInsight | null;
  generatingInsightKind: ReviewHunkInsightKind | null;
  hasPrevious: boolean;
  hasNext: boolean;
  onOpenSource: () => void;
  onOpenFullDiff: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onMarkReviewed: () => void;
  onContinue: () => void;
  onToggleAttention: () => void;
  onRequestInsight: (kind: ReviewHunkInsightKind) => void;
  onUpdateInsight: (insight: ReviewHunkInsight) => void;
}

function cleanContext(context: string | null): string | null {
  const cleaned = context?.replace(/^[}\s]+|[{\s]+$/g, "").trim();
  return cleaned || null;
}

export function ReviewHunkCard({
  hunk,
  summary,
  current,
  total,
  isSummarizing,
  isReviewed,
  needsAttention,
  streak,
  activeInsightKind,
  insight,
  generatingInsightKind,
  hasPrevious,
  hasNext,
  onOpenSource,
  onOpenFullDiff,
  onPrevious,
  onNext,
  onMarkReviewed,
  onContinue,
  onToggleAttention,
  onRequestInsight,
  onUpdateInsight,
}: ReviewHunkCardProps) {
  const context = cleanContext(hunk.context);
  const sourceLabel = `${hunk.filePath}${hunk.newStart ? `:${hunk.newStart}` : ""}`;
  const copyReviewComment = async () => {
    try {
      await writeClipboardText(insight?.items[0] ?? "");
      toast.success("Review comment copied");
    } catch {
      toast.error("Unable to copy review comment");
    }
  };

  return (
    <Card variant="elevated" role="article" aria-label={`Review hunk ${current} of ${total}`}>
      <CardHeader>
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="accent">
            Hunk {current} of {total}
          </Badge>
          <Badge variant="muted">
            <span className="text-git-added">+{hunk.additions}</span>
            <span className="mx-1 text-border">/</span>
            <span className="text-git-deleted">-{hunk.deletions}</span>
          </Badge>
          <span className="flex items-center gap-1 text-subtle-foreground">
            {isSummarizing ? (
              <AiLoadingIcon className="animate-spin text-primary" />
            ) : (
              <SparkleIcon className="text-primary" />
            )}
            {isSummarizing ? "Refining description…" : "Athas Intelligence"}
          </span>
        </div>
        <CardTitle aria-live="polite">{summary.title}</CardTitle>
        <CardDescription aria-live="polite">{summary.description}</CardDescription>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="accent-ghost"
            onClick={onOpenSource}
            tooltip="Open changed lines"
          >
            <FileCodeIcon />
            <span className="max-w-72 truncate">{sourceLabel}</span>
          </Button>
          {context ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onOpenSource}
              tooltip="Open symbol in editor"
            >
              <CodeIcon />
              <span className="max-w-64 truncate">{context}</span>
            </Button>
          ) : null}
        </div>
        <CardAction>
          <Button type="button" variant="ghost" onClick={onOpenFullDiff}>
            <EyeIcon />
            Full diff
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="border-border/70 border-y px-0">
        <TextDiffViewer
          diff={hunk.diff}
          isStaged={hunk.fileKey.startsWith("staged:")}
          viewMode="unified"
          showWhitespace={false}
          isEmbeddedInScrollView
        />
      </CardContent>

      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium text-foreground">Review with Intelligence</div>
            <div className="text-subtle-foreground">Generate only the context you need.</div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1">
            {INSIGHT_ACTIONS.map(({ kind, label, icon: Icon }) => (
              <Button
                key={kind}
                type="button"
                variant={activeInsightKind === kind ? "accent" : "ghost"}
                aria-pressed={activeInsightKind === kind}
                disabled={generatingInsightKind !== null}
                onClick={() => onRequestInsight(kind)}
              >
                {generatingInsightKind === kind ? (
                  <AiLoadingIcon className="animate-spin" />
                ) : (
                  <Icon />
                )}
                {label}
              </Button>
            ))}
          </div>
        </div>

        {insight ? (
          <div className="rounded-chrome bg-background/70 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 font-medium text-foreground">
                <SparkleIcon className="text-primary" />
                {insight.title}
              </div>
              {insight.kind === "comment" ? (
                <Button
                  type="button"
                  variant="ghost"
                  iconOnly
                  tooltip="Copy review comment"
                  onClick={() => void copyReviewComment()}
                >
                  <CopyIcon />
                </Button>
              ) : null}
            </div>
            {insight.kind === "comment" ? (
              <Textarea
                value={insight.items[0] ?? ""}
                rows={3}
                onChange={(event) =>
                  onUpdateInsight({ ...insight, items: [event.currentTarget.value] })
                }
                aria-label="Draft review comment"
              />
            ) : (
              <ul className="space-y-1.5 text-subtle-foreground">
                {insight.items.map((item) => (
                  <li key={item} className="flex items-start gap-1.5">
                    <SparkleIcon className="mt-0.5 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex-wrap justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            disabled={!hasPrevious}
            onClick={onPrevious}
            tooltip="Previous hunk"
            shortcut="J"
          >
            <ArrowLeftIcon />
            Previous
            <Kbd>J</Kbd>
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!hasNext}
            onClick={onNext}
            tooltip="Next hunk"
            shortcut="K"
          >
            Next
            <Kbd>K</Kbd>
            <ArrowRightIcon />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            active={needsAttention}
            aria-pressed={needsAttention}
            onClick={onToggleAttention}
          >
            <WarningCircleIcon />
            Needs attention
          </Button>
          {streak >= 2 ? (
            <Badge variant="warning">
              <LightningIcon />
              {streak} streak
            </Badge>
          ) : null}
          <Button
            type="button"
            variant={isReviewed ? "default" : "accent"}
            onClick={isReviewed ? onContinue : onMarkReviewed}
          >
            {isReviewed ? <ArrowRightIcon /> : <CheckIcon />}
            {isReviewed ? "Continue review" : "Reviewed & next"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
