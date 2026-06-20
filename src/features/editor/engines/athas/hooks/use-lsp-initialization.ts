/**
 * Hook to initialize LSP diagnostics listener early in the app lifecycle.
 * This ensures diagnostics events are captured even before files are opened.
 */

import { useEffect } from "react";
import { LspClient } from "@/features/editor/lsp/lsp-client";

/**
 * Initialize the LSP client singleton to set up diagnostics listener.
 * This should be called early in the app lifecycle.
 */
export function useLspInitialization() {
  useEffect(() => {
    // Initialize LspClient singleton - this triggers the diagnostics listener setup
    LspClient.getInstance();
  }, []);
}
