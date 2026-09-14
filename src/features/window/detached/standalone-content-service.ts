import { toast } from "sonner";
import type { OpenContentSpec } from "@/features/panes/types/pane-content.types";
import { useProjectStore } from "@/features/window/stores/project.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";

export type StandaloneContentSpec = Extract<
  OpenContentSpec,
  {
    type:
      | "terminal"
      | "settings"
      | "extensions"
      | "pullRequest"
      | "githubIssue"
      | "githubAction"
      | "githubDelivery"
      | "githubForm";
  }
>;

export async function openStandaloneContentWindow(
  content: StandaloneContentSpec,
  workingDirectory = useProjectStore.getState().rootFolderPath,
) {
  try {
    return await createAppWindow({ content, workingDirectory });
  } catch (error) {
    toast.error(`Could not open a new window: ${String(error)}`);
    return null;
  }
}

export function openTerminalWindow(
  options: Omit<Extract<StandaloneContentSpec, { type: "terminal" }>, "type"> = {},
) {
  return openStandaloneContentWindow({
    type: "terminal",
    workingDirectory: useProjectStore.getState().rootFolderPath,
    ...options,
  });
}
