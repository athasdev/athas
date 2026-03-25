import { openUrl } from "@tauri-apps/plugin-opener";
import { BookOpen, CircleUser, CreditCard, ExternalLink, LogIn, LogOut, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { toast } from "@/ui/toast";
import { Button } from "@/ui/button";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import Tooltip from "@/ui/tooltip";
import {
  beginDesktopAuthSession,
  DesktopAuthError,
  waitForDesktopAuthToken,
} from "@/features/window/services/auth-api";

interface AccountMenuProps {
  iconSize?: number;
  className?: string;
}

export const AccountMenu = ({ iconSize = 14, className }: AccountMenuProps) => {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const subscription = useAuthStore((s) => s.subscription);
  const logout = useAuthStore((s) => s.logout);
  const handleAuthCallback = useAuthStore((s) => s.handleAuthCallback);
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
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPosition({
      x: rect.right - 190,
      y: rect.bottom + 8,
    });
    setIsOpen(true);
  };

  const handleSignIn = async () => {
    try {
      const { sessionId, pollSecret, loginUrl } = await beginDesktopAuthSession();
      if (import.meta.env.DEV) {
        console.log("[Auth] Opening desktop login URL:", loginUrl);
      }
      await openUrl(loginUrl);
      toast.info("Complete sign-in in your browser. Waiting for confirmation...");

      const token = await waitForDesktopAuthToken(sessionId, pollSecret);
      await handleAuthCallback(token);
      toast.success("Signed in successfully!");
    } catch (error) {
      if (error instanceof DesktopAuthError && error.code === "endpoint_unavailable") {
        toast.error(
          "Desktop sign-in endpoint is unavailable on this server. Please use the local dev www server.",
        );
        return;
      }

      const message = error instanceof Error ? error.message : "Authentication failed.";
      toast.error(message);
    }
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

  const signedOutItems: ContextMenuItem[] = [
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

  const signedInItems: ContextMenuItem[] = [
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
          onClick={handleClick}
          type="button"
          variant="secondary"
          size="icon-sm"
          className={className}
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
      <ContextMenu
        isOpen={isOpen}
        position={menuPosition}
        items={isAuthenticated ? signedInItems : signedOutItems}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
};
