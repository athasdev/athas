import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleUser, CreditCard, ExternalLink, LogIn, LogOut } from "lucide-react";
import { useRef, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import Tooltip from "@/ui/tooltip";
import { getDesktopLoginUrl } from "@/utils/auth-api";
import { cn } from "@/utils/cn";

interface AccountMenuProps {
  iconSize?: number;
  className?: string;
}

export const AccountMenu = ({ iconSize = 14, className }: AccountMenuProps) => {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const subscription = useAuthStore((s) => s.subscription);
  const logout = useAuthStore((s) => s.logout);

  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPosition({
      x: rect.right - 190,
      y: rect.bottom + 4,
    });
    setIsOpen(true);
  };

  const handleSignIn = async () => {
    await openUrl(getDesktopLoginUrl());
  };

  const handleSignOut = async () => {
    await logout();
  };

  const handleManageAccount = async () => {
    await openUrl("https://athas.dev/dashboard");
  };

  const handleViewPricing = async () => {
    await openUrl("https://athas.dev/pricing");
  };

  const subscriptionStatus = subscription?.status ?? "free";

  const signedOutItems: ContextMenuItem[] = [
    {
      id: "sign-in",
      label: "Sign In",
      icon: <LogIn size={12} />,
      onClick: handleSignIn,
    },
  ];

  const signedInItems: ContextMenuItem[] = [
    {
      id: "user-info",
      label: user?.name || user?.email || "Account",
      icon: user?.avatar_url ? (
        <img src={user.avatar_url} alt="" className="h-3 w-3 rounded-full" />
      ) : (
        <CircleUser size={12} />
      ),
      onClick: () => {},
      disabled: true,
    },
    {
      id: "plan-separator",
      label: "",
      separator: true,
      onClick: () => {},
    },
    {
      id: "subscription",
      label: `Plan: ${subscriptionStatus === "pro" ? "Pro" : subscriptionStatus === "trial" ? "Trial" : "Free"}`,
      icon: <CreditCard size={12} />,
      onClick: handleViewPricing,
    },
    {
      id: "manage-account",
      label: "Manage Account",
      icon: <ExternalLink size={12} />,
      onClick: handleManageAccount,
    },
    {
      id: "sign-out-separator",
      label: "",
      separator: true,
      onClick: () => {},
    },
    {
      id: "sign-out",
      label: "Sign Out",
      icon: <LogOut size={12} />,
      onClick: handleSignOut,
    },
  ];

  const tooltipLabel = isAuthenticated ? user?.name || user?.email || "Account" : "Account";

  return (
    <>
      <Tooltip content={tooltipLabel} side="bottom">
        <button
          ref={buttonRef}
          onClick={handleClick}
          className={cn(
            "flex items-center justify-center rounded p-1",
            "text-text-lighter transition-colors hover:bg-hover hover:text-text",
            isAuthenticated && "text-blue-400 hover:text-blue-300",
            className,
          )}
          style={{ minHeight: 0, minWidth: 0 }}
        >
          {isAuthenticated && user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="rounded-full"
              style={{ width: iconSize, height: iconSize }}
            />
          ) : (
            <CircleUser size={iconSize} />
          )}
        </button>
      </Tooltip>
      <ContextMenu
        isOpen={isOpen}
        position={menuPosition}
        items={isAuthenticated ? signedInItems : signedOutItems}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
};
