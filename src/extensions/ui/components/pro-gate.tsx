import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useProFeature } from "../hooks/use-pro-feature";
import { ProBadge } from "./pro-badge";

interface ProGateProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function ProGate({ children, fallback }: ProGateProps) {
  const { isPro } = useProFeature();

  if (isPro) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-accent/10">
        <Lock className="size-5 text-accent" />
      </div>
      <div>
        <div className="flex items-center justify-center gap-2">
          <p className="font-medium text-sm text-text">Pro Feature</p>
          <ProBadge />
        </div>
        <p className="mt-1 text-text-lighter text-xs">Upgrade to Pro to unlock this feature.</p>
      </div>
    </div>
  );
}
