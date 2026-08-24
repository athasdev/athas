import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useMemo, useState } from "react";
import { ProGate } from "@/features/window/components/pro-gate";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import {
  normalizeGenerativeUIView,
  OPEN_EXTERNAL_VIEW_COMMAND,
} from "../services/generative-ui-adapter";
import { useUIExtensionStore } from "../stores/ui-extension-store";
import type { GenerativeUIView } from "../types/generative-ui";
import type { ExtensionViewAction } from "../types/extension-view";
import { ExtensionViewRenderer } from "./extension-view-renderer";

interface GenerativeUIRendererProps {
  component: GenerativeUIView;
}

function resolveExternalUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("The external URL is missing.");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS links can be opened from generated UI.");
  }
  return url.toString();
}

export function GenerativeUIRenderer({ component }: GenerativeUIRendererProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const result = useMemo(() => {
    try {
      return { node: normalizeGenerativeUIView(component), error: null };
    } catch (error) {
      return {
        node: null,
        error: error instanceof Error ? error.message : "Generated UI is invalid.",
      };
    }
  }, [component]);

  const execute = useCallback(async (action: ExtensionViewAction, extraArgs: unknown[] = []) => {
    setActionError(null);
    const args = [...(action.args ?? []), ...extraArgs];
    try {
      if (action.command === OPEN_EXTERNAL_VIEW_COMMAND) {
        await openUrl(resolveExternalUrl(args[0]));
        return;
      }

      const command = useUIExtensionStore.getState().commands.get(action.command);
      if (!command) throw new Error(`Generated UI command is not available: ${action.command}`);
      await command.execute(...args);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Generated UI action failed.");
    }
  }, []);

  const error = result.error ?? actionError;

  return (
    <ProGate>
      {error ? (
        <Alert tone="error" role="alert">
          <AlertTitle>Generated UI unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : result.node ? (
        <ExtensionViewRenderer node={result.node} execute={execute} surface="embedded" />
      ) : null}
    </ProGate>
  );
}
