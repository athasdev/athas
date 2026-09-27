import { toast } from "sonner";
import { type AcpAuthRequest, useAcpAuthStore } from "@/features/ai/stores/acp-auth.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import { KeyIcon, TerminalWindowIcon } from "@/ui/icons";

/**
 * The sign-in methods an agent offered, shown where its authentication error is. Agent methods
 * sign in through the agent; terminal methods open an Athas terminal running the command shown,
 * and the agent restarts once it exits successfully. The failed prompt is retried after either.
 */
export function AcpAuthChoice({
  request,
  chatId,
  onSignedIn,
}: {
  request: AcpAuthRequest;
  chatId?: string | null;
  onSignedIn?: () => void | Promise<void>;
}) {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const { choose, cancel } = useAcpAuthStore.use.actions();
  const busy = request.phase !== "choosing";

  const signIn = async (methodId: string) => {
    const signedIn = await choose(methodId, {
      chatId,
      workingDirectory: rootFolderPath ?? undefined,
    });
    if (!signedIn) return;
    if (onSignedIn) await onSignedIn();
    else toast.success("Signed in to the agent");
  };

  return (
    <span className="flex min-w-0 flex-col gap-2">
      <span className="text-foreground">Choose how to sign in.</span>
      {request.methods.map((method) => {
        const active = request.activeMethodId === method.id;
        const Icon = method.kind === "terminal" ? TerminalWindowIcon : KeyIcon;
        return (
          <span key={method.id} className="flex min-w-0 flex-col items-start gap-0.5">
            <Button
              type="button"
              variant="default"
              disabled={busy}
              onClick={() => void signIn(method.id)}
            >
              <Icon />
              {active && request.phase === "terminal"
                ? "Finish signing in in the terminal…"
                : active
                  ? "Signing in…"
                  : method.name}
            </Button>
            {method.description ? (
              <span className="text-pretty text-subtle-foreground">{method.description}</span>
            ) : null}
            {method.terminal ? (
              <code className="font-mono wrap-anywhere select-text text-subtle-foreground ui-text-caption">
                {[method.terminal.command, ...method.terminal.args].join(" ")}
              </code>
            ) : null}
          </span>
        );
      })}
      {request.phase === "terminal" ? (
        <span>
          <Button type="button" variant="ghost" onClick={cancel}>
            Stop waiting
          </Button>
        </span>
      ) : null}
      {request.error ? <span className="text-destructive">{request.error}</span> : null}
    </span>
  );
}
