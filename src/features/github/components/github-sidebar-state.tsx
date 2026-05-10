import type { ReactNode } from "react";
import { SidebarEmptyActionState } from "@/ui/sidebar";

interface GitHubSidebarStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  isActionDisabled?: boolean;
  className?: string;
  tone?: "neutral" | "error";
}

export function GitHubSidebarState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  isActionDisabled = false,
  className,
  tone = "neutral",
}: GitHubSidebarStateProps) {
  const isError = tone === "error";

  return (
    <SidebarEmptyActionState
      className={className}
      icon={icon}
      message={title}
      description={description}
      actionLabel={actionLabel}
      onAction={onAction}
      actionDisabled={isActionDisabled}
      tone={isError ? "error" : "neutral"}
    />
  );
}
