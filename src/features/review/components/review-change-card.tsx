import {
  CheckCircleIcon,
  CheckIcon,
  GitCommitIcon,
  GitDiffIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
  WarningIcon,
} from "@/ui/icons";
import { SidebarIconButton, SidebarListActionRow, SidebarListItem } from "@/ui/sidebar";
import Tooltip from "@/ui/tooltip";
import { formatRelativeDate } from "@/utils/date";
import type { ReviewChangeSet, ReviewRiskLevel } from "../types/review.types";

const RISK_LABELS: Record<ReviewRiskLevel, string> = {
  high: "High attention",
  medium: "Review closely",
  low: "Focused",
};

const RISK_ICONS = {
  high: WarningIcon,
  medium: ShieldWarningIcon,
  low: ShieldCheckIcon,
};

const RISK_ICON_TONES = {
  high: "text-destructive",
  medium: "text-warning",
  low: "text-success",
};

interface ReviewChangeCardProps {
  changeSet: ReviewChangeSet;
  onOpen: () => void;
  onMarkReviewed?: () => void;
  showReviewed?: boolean;
}

export function ReviewChangeCard({
  changeSet,
  onOpen,
  onMarkReviewed,
  showReviewed = false,
}: ReviewChangeCardProps) {
  const RiskIcon = RISK_ICONS[changeSet.risk];
  const relativeDate =
    changeSet.kind === "working-tree" ? "Live" : formatRelativeDate(changeSet.date ?? "");
  const metadata = [
    `${changeSet.files.length} ${changeSet.files.length === 1 ? "file" : "files"}`,
    changeSet.author,
  ]
    .filter(Boolean)
    .join(" · ");
  const riskTooltip = [RISK_LABELS[changeSet.risk], ...changeSet.riskReasons].join(" · ");
  const KindIcon = changeSet.kind === "working-tree" ? GitDiffIcon : GitCommitIcon;
  const row = (
    <SidebarListItem
      leading={
        <Tooltip content={riskTooltip}>
          <span
            className={`flex items-center justify-center ${RISK_ICON_TONES[changeSet.risk]}`}
            aria-label={RISK_LABELS[changeSet.risk]}
          >
            <RiskIcon />
          </span>
        </Tooltip>
      }
      description={
        <span className="flex min-w-0 items-center gap-1.5">
          <KindIcon className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{metadata}</span>
          <span className="shrink-0 font-mono tabular-nums">
            <span className="text-success">+{changeSet.additions}</span>{" "}
            <span className="text-destructive">-{changeSet.deletions}</span>
          </span>
          {showReviewed && changeSet.reviewed ? (
            <span
              className="flex shrink-0 items-center text-success"
              aria-label="Reviewed"
              title="Reviewed"
            >
              <CheckCircleIcon />
            </span>
          ) : null}
        </span>
      }
      trailing={relativeDate}
      onClick={onOpen}
      aria-label={`Open ${changeSet.title} diff, ${RISK_LABELS[changeSet.risk]}`}
    >
      {changeSet.title}
    </SidebarListItem>
  );

  if (!onMarkReviewed) return row;

  return (
    <SidebarListActionRow
      actions={[
        <SidebarIconButton
          key="reviewed"
          tooltip="Mark reviewed"
          onClick={(event) => {
            event.stopPropagation();
            onMarkReviewed();
          }}
        >
          <CheckIcon />
        </SidebarIconButton>,
      ]}
    >
      {row}
    </SidebarListActionRow>
  );
}
