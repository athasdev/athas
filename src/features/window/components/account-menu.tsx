import { openUrl } from "@tauri-apps/plugin-opener";
import { memo, useEffect, useRef, useState } from "react";
import { getServiceUrls } from "@/config/services";
import { useGitHubStore } from "@/features/github/stores/github.store";
import { getGitHubAvatarUrl } from "@/features/github/utils/github-avatar-url";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { useWhatsNewStore } from "@/features/settings/stores/whats-new.store";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { getAccountPlanLabel } from "@/features/window/lib/account-usage";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Avatar } from "@/ui/avatar";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dropdown, type DropdownSection, type MenuItem } from "@/ui/dropdown";
import {
  BookOpenIcon,
  ChatCircleTextIcon,
  ClockCounterClockwiseIcon,
  CreditCardIcon,
  GearSixIcon,
  GithubLogoIcon,
  MegaphoneIcon,
  SignInIcon,
  SignOutIcon,
  UserIcon,
  UsersThreeIcon,
} from "@/ui/icons";
import Tooltip from "@/ui/tooltip";

const COMMUNITY_URL = "https://discord.gg/DD8F38wFMv";

function isBlockingModalOpen() {
  const state = useUIState.getState();
  return (
    state.isQuickOpenVisible ||
    state.isCommandPaletteVisible ||
    state.isGlobalSearchVisible ||
    state.isSettingsDialogVisible ||
    state.isProjectPickerVisible ||
    state.isDatabaseConnectionVisible
  );
}

export const AccountMenu = memo(function AccountMenu() {
  const services = getServiceUrls();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const subscription = useAuthStore((s) => s.subscription);
  const logout = useAuthStore((s) => s.actions.logout);
  const githubAccountStatus = useGitHubStore((state) => state.githubAccountStatus);
  const githubCurrentUser = useGitHubStore((state) => state.currentUser);
  const checkGitHubAuth = useGitHubStore((state) => state.actions.checkAuth);
  const openWhatsNew = useWhatsNewStore((state) => state.actions.open);
  const setIsSettingsDialogVisible = useUIState((state) => state.setIsSettingsDialogVisible);
  const openSettingsDialog = useUIState((state) => state.openSettingsDialog);

  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const { signIn, isSigningIn } = useDesktopSignIn({
    onSuccess: () => setIsOpen(false),
  });
  const settingsShortcut = useCommandShortcut("workbench.openSettings");

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
    await openUrl(services.dashboardUrl);
  };

  const handleOpenBillingDashboard = async () => {
    await openUrl(services.dashboardBillingUrl);
  };

  const handleOpenDocs = async () => {
    await openUrl(services.docsUrl);
  };

  const handleOpenChangelog = async () => {
    await openUrl(services.githubReleasesBaseUrl);
  };

  const handleOpenCommunity = async () => {
    await openUrl(COMMUNITY_URL);
  };

  const handleOpenWhatsNew = async () => {
    await openWhatsNew();
  };

  const handleOpenSettings = () => {
    setIsSettingsDialogVisible(true);
  };

  const handleOpenCollaboration = () => {
    openSettingsDialog("collaboration");
  };

  const isTeams = Boolean(subscription?.collaboration?.enabled);
  const planLabel = getAccountPlanLabel(subscription, isAuthenticated);
  const githubLogin =
    githubAccountStatus === "connected" ? githubCurrentUser || user?.github_username : null;
  const accountName = user?.name || githubLogin || user?.email || "Account";
  const accountDetail = githubLogin ? `@${githubLogin}` : user?.email;
  const accountAvatarUrl = getGitHubAvatarUrl(
    {
      login: githubLogin,
      avatarUrl: user?.avatar_url,
    },
    64,
  );

  const signedOutAccountItems: MenuItem[] = [
    {
      id: "settings",
      label: "Settings",
      icon: <GearSixIcon />,
      shortcut: settingsShortcut,
      onClick: handleOpenSettings,
    },
  ];

  const sessionItems: MenuItem[] = [
    {
      id: isAuthenticated ? "sign-out" : "sign-in",
      label: isAuthenticated ? "Sign Out" : isSigningIn ? "Signing In..." : "Sign In",
      icon: isAuthenticated ? <SignOutIcon /> : <SignInIcon />,
      onClick: isAuthenticated ? handleSignOut : handleSignIn,
      disabled: !isAuthenticated && isSigningIn,
    },
  ];

  const signedInAccountItems: MenuItem[] = [
    {
      id: "profile",
      label: "Profile",
      icon: <UserIcon />,
      onClick: handleManageAccount,
    },
    {
      id: "subscription",
      label: "Plan & Billing",
      icon: <CreditCardIcon />,
      trailing: { type: "text", label: planLabel },
      onClick: handleOpenBillingDashboard,
    },
    ...(githubLogin
      ? [
          {
            id: "github-profile",
            label: "GitHub Profile",
            icon: <GithubLogoIcon />,
            trailing: { type: "text" as const, label: "Connected" },
            onClick: () => openUrl(`https://github.com/${encodeURIComponent(githubLogin)}`),
          },
        ]
      : [
          {
            id: "github-connect",
            label: "Connect GitHub",
            icon: <GithubLogoIcon />,
            onClick: () => openUrl(services.dashboardIntegrationsUrl),
          },
        ]),
    ...(isTeams
      ? [
          {
            id: "collaboration",
            label: "Collaboration",
            icon: <UsersThreeIcon />,
            onClick: handleOpenCollaboration,
          },
        ]
      : []),
    {
      id: "settings",
      label: "Settings",
      icon: <GearSixIcon />,
      shortcut: settingsShortcut,
      onClick: handleOpenSettings,
    },
  ];

  const resourceItems: MenuItem[] = [
    {
      id: "whats-new",
      label: "What's New",
      icon: <MegaphoneIcon />,
      onClick: handleOpenWhatsNew,
    },
    {
      id: "changelog",
      label: "Changelog",
      icon: <ClockCounterClockwiseIcon />,
      onClick: handleOpenChangelog,
    },
    {
      id: "docs",
      label: "Documentation",
      icon: <BookOpenIcon />,
      onClick: handleOpenDocs,
    },
    {
      id: "community",
      label: "Community",
      icon: <ChatCircleTextIcon />,
      onClick: handleOpenCommunity,
    },
  ];

  const sections: DropdownSection[] = [
    {
      id: "account",
      label: isAuthenticated ? undefined : "Account",
      items: isAuthenticated ? signedInAccountItems : signedOutAccountItems,
    },
    {
      id: "resources",
      label: "Resources",
      items: resourceItems,
    },
    {
      id: "session",
      items: sessionItems,
    },
  ];

  const tooltipLabel = isAuthenticated ? accountName : "Account";

  useEffect(() => {
    if (!isOpen) return;

    const closeForBlockingModal = () => {
      if (isBlockingModalOpen()) setIsOpen(false);
    };

    closeForBlockingModal();
    return useUIState.subscribe(closeForBlockingModal);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    void checkGitHubAuth();
  }, [checkGitHubAuth, isOpen]);

  return (
    <>
      <div ref={triggerRef}>
        <Tooltip content={tooltipLabel}>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            size="chrome"
            onClick={() => setIsOpen((open) => !open)}
            active={isOpen}
            aria-expanded={isOpen}
            aria-haspopup="menu"
            aria-label="Account"
          >
            <Avatar name={accountName} src={accountAvatarUrl} className="size-4" />
          </Button>
        </Tooltip>
      </div>
      <Dropdown
        isOpen={isOpen}
        anchorRef={triggerRef}
        anchorSide="bottom"
        anchorAlign="end"
        onClose={() => setIsOpen(false)}
        className="w-fit min-w-64 max-w-72"
        header={
          isAuthenticated ? (
            <div role="presentation" className="flex min-w-0 items-center gap-2.5 px-2.5 py-2">
              <Avatar name={accountName} src={accountAvatarUrl} className="size-9" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{accountName}</div>
                {accountDetail ? (
                  <div className="truncate text-subtle-foreground">{accountDetail}</div>
                ) : null}
              </div>
              <Badge variant="muted" className="shrink-0">
                {planLabel}
              </Badge>
            </div>
          ) : undefined
        }
        sections={sections}
      />
    </>
  );
});
