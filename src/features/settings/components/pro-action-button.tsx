import { Lock } from "@phosphor-icons/react";
import { useProFeature } from "@/extensions/ui/hooks/use-pro-feature";
import { Button, type ButtonProps } from "@/ui/button";
import { useUpgradeToPro } from "../hooks/use-upgrade-to-pro";

interface ProActionButtonProps extends Omit<ButtonProps, "onClick"> {
  onProClick: () => void;
}

export function ProActionButton({ onProClick, children, ...props }: ProActionButtonProps) {
  const { isPro, isAuthenticated } = useProFeature();
  const { promptUpgrade } = useUpgradeToPro();
  const isSignedInFree = isAuthenticated && !isPro;

  return (
    <Button
      {...props}
      onClick={isPro ? onProClick : promptUpgrade}
      tooltip={isPro ? props.tooltip : isSignedInFree ? "Upgrade to Pro" : "Sign in to continue"}
    >
      {isSignedInFree && <Lock className="size-3.5" />}
      {children}
    </Button>
  );
}
