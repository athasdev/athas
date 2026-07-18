import { type ReactNode, useEffect, useId, useState } from "react";
import { SidebarSectionHeader } from "@/ui/sidebar";

interface GitHubSidebarSectionProps {
  title: ReactNode;
  count: number;
  children: ReactNode;
  defaultExpanded?: boolean;
  forceExpanded?: boolean;
}

export function GitHubSidebarSection({
  title,
  count,
  children,
  defaultExpanded = true,
  forceExpanded = false,
}: GitHubSidebarSectionProps) {
  const contentId = useId();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const expanded = forceExpanded || isExpanded;

  useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  return (
    <section className="space-y-px pt-1 first:pt-0">
      <SidebarSectionHeader
        aria-controls={contentId}
        expanded={expanded}
        count={count}
        onToggle={() => setIsExpanded((current) => !current)}
      >
        {title}
      </SidebarSectionHeader>
      {expanded ? (
        <div id={contentId} className="space-y-px">
          {children}
        </div>
      ) : null}
    </section>
  );
}
