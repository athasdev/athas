import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BookOpen,
  CircleUser,
  CreditCard,
  ExternalLink,
  LogIn,
  LogOut,
  Settings,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import Tooltip from "@/ui/tooltip";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";

interface AccountMenuProps {
  iconSize?: number;
  className?: string;
}

export const AccountMenu = ({ iconSize = 14, className }: AccountMenuProps) => {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const subscription = useAuthStore((s) => s.subscription);
  const logout = useAuthStore((s) => s.logout);
  const setIsSettingsDialogVisible = useUIState((state) => state.setIsSettingsDialogVisible);
  const hasBlockingModalOpen = useUIState(
    (state) =>
      state.isQuickOpenVisible ||
      state.isCommandPaletteVisible ||
      state.isGlobalSearchVisible ||
      state.isSettingsDialogVisible ||
      state.isThemeSelectorVisible ||
      state.isIconThemeSelectorVisible ||
      state.isProjectPickerVisible ||
      state.isDatabaseConnectionVisible,
  );

  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { signIn } = useDesktopSignIn({
    onSuccess: () => setIsOpen(false),
  });

  const handleSignIn = async () => {
    if (import.meta.env.DEV) {
      console.log("[Auth] Starting desktop sign-in flow from account menu");
    }
    await signIn();
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

  const handleOpenDocs = async () => {
    await openUrl("https://athas.dev/docs");
  };

  const handleOpenSettings = () => {
    setIsSettingsDialogVisible(true);
  };

  const subscriptionStatus = subscription?.status ?? "free";
  const isEnterprise = subscription?.subscription?.plan === "enterprise";

  const signedOutItems: MenuItem[] = [
    {
      id: "settings",
      label: "Settings",
      icon: <Settings />,
      onClick: handleOpenSettings,
    },
    {
      id: "docs",
      label: "Docs",
      icon: <BookOpen />,
      onClick: handleOpenDocs,
    },
    {
      id: "settings-separator",
      label: "",
      separator: true,
      onClick: () => {},
    },
    {
      id: "sign-in",
      label: "Sign In",
      icon: <LogIn />,
      onClick: handleSignIn,
    },
  ];

  const signedInItems: MenuItem[] = [
    {
      id: "user-info",
      label: user?.name || user?.email || "Account",
      icon: user?.avatar_url ? (
        <img src={user.avatar_url} alt="" className="size-3 rounded-full" />
      ) : (
        <CircleUser />
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
      label: `Plan: ${isEnterprise ? "Enterprise" : subscriptionStatus === "pro" ? "Pro" : "Free"}`,
      icon: <CreditCard />,
      onClick: handleViewPricing,
    },
    {
      id: "manage-account",
      label: "Manage Account",
      icon: <ExternalLink />,
      onClick: handleManageAccount,
    },
    {
      id: "settings",
      label: "Settings",
      icon: <Settings />,
      onClick: handleOpenSettings,
    },
    {
      id: "docs",
      label: "Docs",
      icon: <BookOpen />,
      onClick: handleOpenDocs,
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
      icon: <LogOut />,
      onClick: handleSignOut,
    },
  ];

  const tooltipLabel = isAuthenticated ? user?.name || user?.email || "Account" : "Account";

  useEffect(() => {
    if (!isOpen || !hasBlockingModalOpen) return;
    setIsOpen(false);
  }, [hasBlockingModalOpen, isOpen]);

  return (
    <>
      <Tooltip content={tooltipLabel} side="bottom">
        <Button
          ref={buttonRef}
          onClick={() => setIsOpen((open) => !open)}
          type="button"
          variant="secondary"
          size="icon-sm"
          className={className}
          aria-expanded={isOpen}
          aria-haspopup="menu"
        >
          {isAuthenticated && user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="rounded-full object-cover"
              style={{ width: iconSize, height: iconSize }}
            />
          ) : (
            <CircleUser size={iconSize} />
          )}
        </Button>
      </Tooltip>
      <Dropdown
        isOpen={isOpen}
        anchorRef={buttonRef}
        anchorAlign="end"
        items={isAuthenticated ? signedInItems : signedOutItems}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
};
