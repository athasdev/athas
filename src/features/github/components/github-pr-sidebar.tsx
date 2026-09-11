import type { ReactNode } from "react";
import Badge from "@/ui/badge";
import { ChatBubbleTextIcon, CheckCircleIcon, ClockIcon, XCircleIcon } from "@/ui/icons";
import { ResourceSection } from "@/ui/resource";
import type { Label, PullRequestDetails } from "../types/github.types";
import { GitHubAssigneePicker, GitHubLabelPicker } from "./github-metadata-pickers";
import { GitHubUserChip } from "./github-chips";
import { CIStatusIndicator, LabelBadges, LinkedIssuesList } from "./pr-status";

interface GitHubPRSidebarProps {
  pr: PullRequestDetails;
  checksSummary: string;
  availableLabels: Label[];
  onLabelsChange: (labels: Label[]) => void;
  onAssigneesChange: (assignees: PullRequestDetails["assignees"]) => void;
  repoPath?: string;
  repositoryUrl?: string;
}

type ReviewerState = "requested" | "approved" | "changes-requested" | "commented";

interface ReviewerRow {
  login: string;
  avatarUrl?: string | null;
  state: ReviewerState;
}

const REVIEWER_STATE: Record<ReviewerState, { label: string; icon: ReactNode }> = {
  requested: { label: "Requested", icon: <ClockIcon className="text-subtle-foreground" /> },
  approved: { label: "Approved", icon: <CheckCircleIcon className="text-success" /> },
  "changes-requested": {
    label: "Changes requested",
    icon: <XCircleIcon className="text-destructive" />,
  },
  commented: {
    label: "Commented",
    icon: <ChatBubbleTextIcon className="text-subtle-foreground" />,
  },
};

function toReviewerState(reviewState: string): ReviewerState {
  if (reviewState === "APPROVED") return "approved";
  if (reviewState === "CHANGES_REQUESTED") return "changes-requested";
  return "commented";
}

function getReviewerRows(pr: PullRequestDetails): ReviewerRow[] {
  const requested = pr.reviewRequests.map<ReviewerRow>((request) => ({
    login: request.login,
    avatarUrl: request.avatarUrl,
    state: "requested",
  }));
  const requestedLogins = new Set(requested.map((row) => row.login.toLowerCase()));
  const reviewed = pr.reviews
    .filter((review) => !requestedLogins.has(review.login.toLowerCase()))
    .map<ReviewerRow>((review) => ({
      login: review.login,
      avatarUrl: review.avatarUrl,
      state: toReviewerState(review.state),
    }));
  return [...reviewed, ...requested];
}

function ReviewDecisionBadge({ decision }: { decision: string | null }) {
  if (decision === "APPROVED") return <Badge variant="success">Approved</Badge>;
  if (decision === "CHANGES_REQUESTED") return <Badge variant="error">Changes requested</Badge>;
  if (decision === "REVIEW_REQUIRED") return <Badge variant="warning">Review required</Badge>;
  return null;
}

export function GitHubPRSidebar({
  pr,
  checksSummary,
  availableLabels,
  onLabelsChange,
  onAssigneesChange,
  repoPath,
  repositoryUrl,
}: GitHubPRSidebarProps) {
  const reviewers = getReviewerRows(pr);
  const assigneeLogins = pr.assignees.map((assignee) => assignee.login);
  const changeAssignees = (usernames: string[]) => {
    onAssigneesChange(
      usernames.map(
        (login) => pr.assignees.find((assignee) => assignee.login === login) ?? { login },
      ),
    );
  };
  const selectedLabelNames = new Set(pr.labels.map((label) => label.name));
  const changeLabels = (selectedNames: Set<string>) => {
    onLabelsChange(availableLabels.filter((label) => selectedNames.has(label.name)));
  };

  return (
    <>
      <ResourceSection title="Review" action={<ReviewDecisionBadge decision={pr.reviewDecision} />}>
        {reviewers.length > 0 ? (
          <ul className="space-y-2">
            {reviewers.map((reviewer) => {
              const reviewerState = REVIEWER_STATE[reviewer.state];
              return (
                <li
                  key={reviewer.login}
                  className="flex min-w-0 items-center justify-between gap-2"
                >
                  <GitHubUserChip
                    login={reviewer.login}
                    avatarUrl={reviewer.avatarUrl}
                    className="text-foreground"
                    avatarSize="sm"
                  />
                  <span
                    className="flex shrink-0 items-center [&_svg]:size-3.5"
                    title={reviewerState.label}
                    aria-label={reviewerState.label}
                  >
                    {reviewerState.icon}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <span className="text-subtle-foreground">No reviewers</span>
        )}
      </ResourceSection>

      <ResourceSection title="Checks">
        {pr.statusChecks.length > 0 ? (
          <CIStatusIndicator
            checks={pr.statusChecks}
            repoPath={repoPath}
            repositoryUrl={repositoryUrl}
          />
        ) : (
          <span className="text-subtle-foreground">{checksSummary}</span>
        )}
      </ResourceSection>

      <ResourceSection
        title="Assignees"
        action={
          pr.assignees.length > 0 ? (
            <GitHubAssigneePicker value={assigneeLogins} onChange={changeAssignees} />
          ) : null
        }
      >
        {pr.assignees.length > 0 ? (
          <ul className="space-y-2">
            {pr.assignees.map((assignee) => (
              <li key={assignee.login} className="flex min-w-0 items-center">
                <GitHubUserChip
                  login={assignee.login}
                  avatarUrl={assignee.avatarUrl}
                  className="text-foreground"
                  avatarSize="sm"
                />
              </li>
            ))}
          </ul>
        ) : (
          <GitHubAssigneePicker
            value={assigneeLogins}
            onChange={changeAssignees}
            label="Add assignees"
          />
        )}
      </ResourceSection>

      <ResourceSection
        title="Labels"
        action={
          pr.labels.length > 0 ? (
            <GitHubLabelPicker
              labels={availableLabels}
              selectedNames={selectedLabelNames}
              onChange={changeLabels}
            />
          ) : null
        }
      >
        {pr.labels.length > 0 ? (
          <LabelBadges labels={pr.labels} repositoryUrl={repositoryUrl} kind="pulls" />
        ) : (
          <GitHubLabelPicker
            labels={availableLabels}
            selectedNames={selectedLabelNames}
            onChange={changeLabels}
            label="Add labels"
          />
        )}
      </ResourceSection>

      {pr.linkedIssues.length > 0 ? (
        <ResourceSection title="Linked issues">
          <LinkedIssuesList
            issues={pr.linkedIssues}
            repoPath={repoPath}
            repositoryUrl={repositoryUrl}
          />
        </ResourceSection>
      ) : null}
    </>
  );
}
