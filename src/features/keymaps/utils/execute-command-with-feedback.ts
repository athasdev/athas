import { showToast } from "@/utils/toast";
import { keymapRegistry } from "./registry";

/**
 * Runs a command picked from a surface the user is looking at (the command palette or a menu)
 * and shows an error toast when it fails, for example when its lazily loaded module cannot load.
 * Actions that report their own errors catch them, so they never reach this toast.
 */
export function executeCommandWithFeedback(commandId: string, args?: unknown): Promise<void> {
  return keymapRegistry.executeCommand(commandId, args, {
    onError: (error) => {
      const title = keymapRegistry.getCommand(commandId)?.title ?? commandId;
      showToast({
        message: `Couldn't run ${title}`,
        description: error instanceof Error ? error.message : undefined,
        type: "error",
      });
    },
  });
}
