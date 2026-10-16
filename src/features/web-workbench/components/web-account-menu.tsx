import { useEffect } from "react";
import { toast } from "sonner";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import {
  goToSignIn,
  openWebsitePage,
  WEBSITE_PAGES,
} from "@/features/web-workbench/services/website-links";
import type { WebsiteAccount } from "@/features/web-workbench/services/website-api";
import { useWebAppStore } from "@/features/web-workbench/stores/web-app.store";
import { Avatar } from "@/ui/avatar";
import Badge from "@/ui/badge";
import { GithubMark } from "@/ui/brand-marks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItems,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  type MenuItem,
} from "@/ui/dropdown";
import {
  BookOpenIcon,
  CreditCardIcon,
  HouseIcon,
  SettingsIcon,
  SignInIcon,
  SignOutIcon,
  StopIcon,
  UserIcon,
} from "@/ui/icons";
import { SidebarIconButton } from "@/ui/sidebar";

let accountNoticeShown = false;

/** Tells signed-out and free users what the app can do with an account, once per visit. */
function showAccountNotice(account: WebsiteAccount | null) {
  if (accountNoticeShown || !account) return;
  accountNoticeShown = true;
  const options = { duration: Number.POSITIVE_INFINITY, closeButton: true };
  if (account.status === "signed-out") {
    toast("You are trying Athas on a sample project", {
      ...options,
      description: "Sign in to open your own GitHub repositories in a cloud workspace.",
      action: { label: "Sign In", onClick: goToSignIn },
    });
  } else if (!account.cloudEditor) {
    toast("Open your own repositories with Athas Pro", {
      ...options,
      description: "Pro opens any of your GitHub repositories in a cloud workspace.",
      action: { label: "Upgrade", onClick: () => openWebsitePage(WEBSITE_PAGES.billing) },
    });
  }
}

/**
 * The account menu of the web app. It follows the athas.dev session the page shares with the
 * website, links to the website's account and billing pages, and opens or stops GitHub
 * repositories in cloud workspaces.
 */
export default function WebAccountMenu() {
  const account = useWebAppStore.use.account();
  const cloud = useWebAppStore.use.cloud();
  const { stopWorkspace, signOut } = useWebAppStore.use.actions();
  const openSettings = useUIState((state) => state.openSettings);
  const openProjectPicker = useUIState((state) => state.openProjectPicker);
  const settingsShortcut = useCommandShortcut("workbench.openSettings");
  const signedIn = account?.status === "signed-in" ? account : null;

  useEffect(() => showAccountNotice(account), [account]);

  const workspaceItems: MenuItem[] = [
    {
      id: "open-github-repository",
      label: "Open GitHub Repository",
      icon: <GithubMark />,
      onClick: () => openProjectPicker("githubRepository"),
    },
    ...(cloud.phase !== "idle"
      ? [
          {
            id: "stop-cloud-workspace",
            label: "Stop Cloud Workspace",
            icon: <StopIcon />,
            disabled: cloud.phase === "stopping",
            onClick: () => void stopWorkspace(),
          },
        ]
      : []),
  ];

  const accountItems: MenuItem[] = signedIn
    ? [
        {
          id: "dashboard",
          label: "Dashboard",
          icon: <HouseIcon />,
          onClick: () => openWebsitePage(WEBSITE_PAGES.dashboard),
        },
        {
          id: "account",
          label: "Account",
          icon: <UserIcon />,
          onClick: () => openWebsitePage(WEBSITE_PAGES.account),
        },
        {
          id: "billing",
          label: "Plan & Billing",
          icon: <CreditCardIcon />,
          trailing: { type: "text", label: signedIn.plan === "pro" ? "Pro" : "Free" },
          onClick: () => openWebsitePage(WEBSITE_PAGES.billing),
        },
        {
          id: "integrations",
          label: signedIn.githubConnected ? "Integrations" : "Connect GitHub",
          icon: <GithubMark />,
          onClick: () => openWebsitePage(WEBSITE_PAGES.integrations),
        },
      ]
    : [];

  const appItems: MenuItem[] = [
    {
      id: "settings",
      label: "Settings",
      icon: <SettingsIcon />,
      shortcut: settingsShortcut,
      onClick: () => openSettings(),
    },
    {
      id: "docs",
      label: "Documentation",
      icon: <BookOpenIcon />,
      onClick: () => openWebsitePage(WEBSITE_PAGES.docs),
    },
  ];

  const sessionItems: MenuItem[] = [
    signedIn
      ? {
          id: "sign-out",
          label: "Sign Out",
          icon: <SignOutIcon />,
          onClick: () => void signOut(),
        }
      : { id: "sign-in", label: "Sign In", icon: <SignInIcon />, onClick: goToSignIn },
  ];

  const sections = [workspaceItems, accountItems, appItems, sessionItems].filter(
    (items) => items.length > 0,
  );
  const accountName = signedIn ? (signedIn.user.name ?? signedIn.user.email) : "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarIconButton tooltip={accountName} aria-label="Account" />}
      >
        <Avatar name={accountName} src={signedIn?.user.avatarUrl} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent size="wide">
        {signedIn ? (
          <div role="presentation" className="flex min-w-0 items-center gap-2.5 px-2.5 py-2">
            <Avatar name={accountName} src={signedIn.user.avatarUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">{accountName}</div>
              <div className="truncate text-subtle-foreground">{signedIn.user.email}</div>
            </div>
            <Badge>{signedIn.plan === "pro" ? "Pro" : "Free"}</Badge>
          </div>
        ) : null}
        {sections.map((items, index) => (
          <DropdownMenuGroup key={items[0]?.id}>
            {index > 0 || signedIn ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItems items={items} />
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
