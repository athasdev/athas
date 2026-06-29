import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BookOpenIcon as BookOpen,
  CreditCardIcon as CreditCard,
  CurrencyDollarIcon as CurrencyDollar,
  SignInIcon as SignIn,
  SignOutIcon as SignOut,
  UserCircleIcon as UserCircle,
  GearSixIcon as GearSix,
  ArrowSquareOutIcon as ArrowSquareOut,
  UsersThreeIcon as UsersThree,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import {
  chromeControl,
  chromeControlGroup,
} from "@/features/layout/components/chrome-control-styles";
import {
  extractAutocompleteUsage,
  formatUsageDate,
  formatUsdFromCents,
  getAccountPlanLabel,
  getAiUsageModeLabel,
  getUsageProgress,
} from "@/features/window/lib/account-usage";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dropdown, MenuItemsList, type MenuItem } from "@/ui/dropdown";
import { TabsList } from "@/ui/tabs";
import Tooltip from "@/ui/tooltip";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { getApiBase } from "@/utils/api-base";
import { cn } from "@/utils/cn";

interface AccountMenuProps {
  className?: string;
}

export const AccountMenu = ({ className }: AccountMenuProps) => {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const subscription = useAuthStore((s) => s.subscription);
  const logout = useAuthStore((s) => s.logout);
  const checkAllProviderApiKeys = useAIChatStore((state) => state.checkAllProviderApiKeys);
  const hasOpenRouterKey = useAIChatStore(
    (state) => state.providerApiKeys.get("openrouter") || false,
  );
  const setIsSettingsDialogVisible = useUIState((state) => state.setIsSettingsDialogVisible);
  const openSettingsDialog = useUIState((state) => state.openSettingsDialog);
  const hasBlockingModalOpen = useUIState(
    (state) =>
      state.isQuickOpenVisible ||
      state.isCommandPaletteVisible ||
      state.isGlobalSearchVisible ||
      state.isSettingsDialogVisible ||
      state.isProjectPickerVisible ||
      state.isDatabaseConnectionVisible,
  );

  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { signIn, isSigningIn } = useDesktopSignIn({
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
    await openUrl(new URL("/dashboard", getApiBase()).toString());
  };

  const handleOpenBillingDashboard = async () => {
    const apiBase = getApiBase();
    await openUrl(new URL("/dashboard/billing", apiBase).toString());
  };

  const handleOpenDocs = async () => {
    await openUrl("https://athas.dev/docs");
  };

  const handleOpenSettings = () => {
    setIsSettingsDialogVisible(true);
  };

  const handleOpenCollaboration = () => {
    openSettingsDialog("collaboration");
  };

  const subscriptionStatus = subscription?.status ?? "free";
  const isEnterprise = subscription?.subscription?.plan === "enterprise";
  const isTeams = Boolean(subscription?.collaboration?.enabled);
  const isPro = subscriptionStatus === "pro";
  const planLabel = getAccountPlanLabel(subscription, isAuthenticated);
  const modeLabel = getAiUsageModeLabel({ isAuthenticated, subscription, hasOpenRouterKey });
  const autocompleteUsage = extractAutocompleteUsage(subscription);
  const usageProgress = getUsageProgress(autocompleteUsage);

  const signedOutItems: MenuItem[] = [
    {
      id: "settings",
      label: "Settings",
      icon: <GearSix weight="duotone" />,
      onClick: handleOpenSettings,
    },
    {
      id: "docs",
      label: "Docs",
      icon: <BookOpen weight="duotone" />,
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
      label: isSigningIn ? "Signing In..." : "Sign In",
      icon: <SignIn weight="duotone" />,
      onClick: handleSignIn,
      disabled: isSigningIn,
    },
  ];

  const signedInItems: MenuItem[] = [
    {
      id: "user-info",
      label: user?.name || user?.email || "Account",
      icon: user?.avatar_url ? (
        <img src={user.avatar_url} alt="" className="size-3 rounded-full" />
      ) : (
        <UserCircle weight="duotone" />
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
      label: `Plan: ${planLabel}`,
      icon: <CreditCard weight="duotone" />,
      onClick: handleOpenBillingDashboard,
    },
    ...(isTeams
      ? [
          {
            id: "collaboration",
            label: "Collaboration",
            icon: <UsersThree weight="duotone" />,
            onClick: handleOpenCollaboration,
          },
        ]
      : []),
    {
      id: "manage-account",
      label: "Manage Account",
      icon: <ArrowSquareOut weight="duotone" />,
      onClick: handleManageAccount,
    },
    {
      id: "settings",
      label: "Settings",
      icon: <GearSix weight="duotone" />,
      onClick: handleOpenSettings,
    },
    {
      id: "docs",
      label: "Docs",
      icon: <BookOpen weight="duotone" />,
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
      icon: <SignOut weight="duotone" />,
      onClick: handleSignOut,
    },
  ];

  const tooltipLabel = isAuthenticated ? user?.name || user?.email || "Account" : "Account";

  useEffect(() => {
    if (!isOpen || !hasBlockingModalOpen) return;
    setIsOpen(false);
  }, [hasBlockingModalOpen, isOpen]);

  useEffect(() => {
    void checkAllProviderApiKeys();
  }, [checkAllProviderApiKeys]);

  useEffect(() => {
    if (!isOpen) return;
    void checkAllProviderApiKeys();
  }, [checkAllProviderApiKeys, isOpen]);

  return (
    <>
      <Tooltip content={tooltipLabel} side="bottom">
        <TabsList variant="segmented" className={cn(chromeControlGroup(), className)}>
          <Button
            ref={buttonRef}
            onClick={() => setIsOpen((open) => !open)}
            type="button"
            variant="ghost"
            compact
            active={isOpen}
            className={chromeControl()}
            aria-expanded={isOpen}
            aria-haspopup="menu"
            aria-label="Account"
          >
            {isAuthenticated && user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="size-4 rounded-full object-cover" />
            ) : (
              <UserCircle className="size-4" weight="duotone" />
            )}
          </Button>
        </TabsList>
      </Tooltip>
      <Dropdown
        isOpen={isOpen}
        anchorRef={buttonRef}
        anchorAlign="end"
        onClose={() => setIsOpen(false)}
        className="w-[320px] overflow-hidden rounded-xl p-0"
      >
        <div className="p-1">
          {isAuthenticated ? (
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                void handleOpenBillingDashboard();
              }}
              className="ui-font block w-full rounded-lg p-2.5 text-left transition-colors hover:bg-hover/50"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="ui-text-sm font-medium text-text">AI usage</span>
                  <Badge
                    variant="default"
                    size="compact"
                    className={cn(
                      isPro || isEnterprise
                        ? "border-accent/30 bg-accent/10 text-accent"
                        : "border-border/60 bg-primary-bg/50 text-text-lighter",
                    )}
                  >
                    {planLabel}
                  </Badge>
                </div>
                <span className="ui-text-sm text-text-lighter">{modeLabel}</span>
              </div>
              {autocompleteUsage ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="ui-text-sm text-text-lighter">Hosted AI</span>
                    <span className="ui-text-sm font-medium text-text">
                      {formatUsdFromCents(autocompleteUsage.spendCents)} /{" "}
                      {formatUsdFromCents(autocompleteUsage.budgetCents)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-primary-bg/80">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-[var(--app-duration-normal)] ease-[var(--app-ease-smooth)]"
                      style={{ width: `${usageProgress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="ui-text-sm text-text-lighter/70">
                      {formatUsageDate(autocompleteUsage.periodStart)} -{" "}
                      {formatUsageDate(autocompleteUsage.periodEnd)}
                    </span>
                    <span className="ui-text-sm text-text-lighter/70">
                      Resets {formatUsageDate(autocompleteUsage.periodEnd)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-text-lighter ui-text-sm">
                  <CurrencyDollar weight="duotone" />
                  <span>Usage unavailable</span>
                </div>
              )}
            </button>
          ) : null}

          {isAuthenticated ? <div className="my-0.5 border-border/70 border-t" /> : null}

          <MenuItemsList
            items={isAuthenticated ? signedInItems : signedOutItems}
            onItemSelect={() => setIsOpen(false)}
          />
        </div>
      </Dropdown>
    </>
  );
};
