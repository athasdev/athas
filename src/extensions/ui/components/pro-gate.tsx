import type { ReactNode } from "react";
import { LockIcon as Lock } from "@/ui/icons";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/ui/empty";
import { useProFeature } from "../hooks/use-pro-feature";
import { ProBadge } from "./pro-badge";

interface ProGateProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function ProGate({ children, fallback }: ProGateProps) {
  const { hasHostedAi } = useProFeature();

  if (hasHostedAi) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-10 rounded-full bg-primary/10 text-primary">
          <Lock className="size-5" />
        </EmptyMedia>
        <EmptyTitle className="flex items-center gap-2">
          Pro Feature
          <ProBadge />
        </EmptyTitle>
        <EmptyDescription>Upgrade to Pro to unlock this feature.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
