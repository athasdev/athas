import { cn } from "@/utils/cn";

interface GitHubSidebarLoadingBarProps {
  isVisible: boolean;
  className?: string;
}

const GitHubSidebarLoadingBar = ({ isVisible, className }: GitHubSidebarLoadingBarProps) => (
  <div
    aria-hidden={!isVisible}
    className={cn(
      "pointer-events-none h-1 shrink-0 overflow-hidden rounded-full bg-secondary-bg/60 opacity-0 transition-opacity",
      isVisible && "opacity-100",
      className,
    )}
  >
    <div className="h-full w-full animate-pulse rounded-full bg-accent/70" />
  </div>
);

export default GitHubSidebarLoadingBar;
