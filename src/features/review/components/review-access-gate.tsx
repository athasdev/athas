import { openUrl } from "@tauri-apps/plugin-opener";
import { getServiceUrls } from "@/config/services";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import { ProBadge } from "@/features/window/components/pro-badge";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { ListChecksIcon, SparkleIcon } from "@/ui/icons";
import { Button } from "@/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/empty";
import { SidebarScrollArea } from "@/ui/sidebar";

export function ReviewAccessGate() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { isSigningIn, signIn } = useDesktopSignIn();
  const services = getServiceUrls();

  return (
    <SidebarScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-2 py-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecksIcon />
            </EmptyMedia>
            <EmptyTitle className="flex items-center gap-2">
              Review with Intelligence
              <ProBadge />
            </EmptyTitle>
            <EmptyDescription>
              Automatic checkpoints, risk signals, and saved progress for every project.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type="button"
              variant="accent"
              disabled={isSigningIn}
              onClick={() => {
                if (isAuthenticated) {
                  void openUrl(services.pricingUrl);
                } else {
                  void signIn();
                }
              }}
            >
              <SparkleIcon />
              {isAuthenticated ? "Upgrade to Pro" : isSigningIn ? "Signing in..." : "Sign in"}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    </SidebarScrollArea>
  );
}
