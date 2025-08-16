import { LspClient } from "@/lib/lsp/lsp-client";
import { useLspStore } from "@/stores/lsp-store";
import type { Extension, ExtensionContext } from "../extension-types";

export class TypeScriptLSPExtension implements Extension {
  public readonly id = "typescript-lsp";
  public readonly displayName = "TypeScript Language Support";
  public readonly description =
    "Provides IntelliSense, error checking, and formatting for TypeScript and JavaScript files";
  public readonly version = "1.0.0";
  public readonly category = "Language Support";

  private lspClient: LspClient | null = null;
  private isEnabled = true;

  contributes = {
    languages: [
      {
        id: "typescript",
        extensions: [".ts", ".tsx"],
        aliases: ["TypeScript", "ts"],
      },
      {
        id: "javascript",
        extensions: [".js", ".jsx", ".mjs", ".cjs"],
        aliases: ["JavaScript", "js"],
      },
    ],
    commands: [
      {
        id: "typescript.restart",
        title: "Restart TypeScript Language Server",
        category: "TypeScript",
      },
      {
        id: "typescript.toggle",
        title: "Toggle TypeScript Language Support",
        category: "TypeScript",
      },
    ],
    settings: [
      {
        id: "typescript.enabled",
        title: "Enable TypeScript Language Support",
        type: "boolean" as const,
        default: true,
        description: "Enable or disable TypeScript language server features",
      },
      {
        id: "typescript.maxCompletionItems",
        title: "Max Completion Items",
        type: "number" as const,
        default: 100,
        description: "Maximum number of completion items to show",
      },
    ],
  };

  async activate(context: ExtensionContext): Promise<void> {
    console.log("Activating TypeScript LSP Extension");

    try {
      // Update status to connecting
      const lspActions = useLspStore.getState().actions;
      lspActions.updateLspStatus("connecting");

      // Initialize LSP client
      this.lspClient = LspClient.getInstance();

      // Note: LSP handlers are managed by the main LSP store

      // Register commands
      context.registerCommand("typescript.restart", this.restartLSP.bind(this));
      context.registerCommand("typescript.toggle", this.toggleLSP.bind(this));

      // Get current workspace path
      const workspacePath = await this.getCurrentWorkspacePath();
      if (workspacePath && this.isEnabled) {
        await this.lspClient.start(workspacePath);
        // Update status to connected with active workspace
        lspActions.updateLspStatus("connected", [workspacePath]);
      } else {
        // No workspace or disabled - set as disconnected
        lspActions.updateLspStatus("disconnected");
      }

      console.log("TypeScript LSP Extension activated successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Failed to activate TypeScript LSP Extension:", error);
      // Update status to error
      const lspActions = useLspStore.getState().actions;
      lspActions.setLspError(`TypeScript LSP activation failed: ${errorMessage}`);
    }
  }

  async deactivate(): Promise<void> {
    console.log("Deactivating TypeScript LSP Extension");

    try {
      if (this.lspClient) {
        await this.lspClient.stopAll();
        this.lspClient = null;
      }
      // Update status to disconnected
      const lspActions = useLspStore.getState().actions;
      lspActions.updateLspStatus("disconnected", []);
    } catch (error) {
      console.error("Error during LSP deactivation:", error);
      const lspActions = useLspStore.getState().actions;
      lspActions.setLspError("Failed to deactivate LSP properly");
    }
  }

  private async getCurrentWorkspacePath(): Promise<string | null> {
    try {
      // This would need to be implemented to get the current workspace
      // For now, we'll use a placeholder
      return null;
    } catch (error) {
      console.error("Failed to get workspace path:", error);
      return null;
    }
  }

  private async restartLSP(): Promise<void> {
    console.log("Restarting TypeScript LSP");

    try {
      const lspActions = useLspStore.getState().actions;
      lspActions.updateLspStatus("connecting");

      if (this.lspClient) {
        await this.lspClient.stopAll();

        const workspacePath = await this.getCurrentWorkspacePath();
        if (workspacePath && this.isEnabled) {
          await this.lspClient.start(workspacePath);
          lspActions.updateLspStatus("connected", [workspacePath]);
        } else {
          lspActions.updateLspStatus("disconnected");
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Failed to restart TypeScript LSP:", error);
      const lspActions = useLspStore.getState().actions;
      lspActions.setLspError(`LSP restart failed: ${errorMessage}`);
    }
  }

  private async toggleLSP(): Promise<void> {
    this.isEnabled = !this.isEnabled;
    console.log(`TypeScript LSP ${this.isEnabled ? "enabled" : "disabled"}`);

    try {
      const lspActions = useLspStore.getState().actions;

      if (this.isEnabled) {
        lspActions.updateLspStatus("connecting");
        const workspacePath = await this.getCurrentWorkspacePath();
        if (workspacePath && this.lspClient) {
          await this.lspClient.start(workspacePath);
          lspActions.updateLspStatus("connected", [workspacePath]);
        } else {
          lspActions.updateLspStatus("disconnected");
        }
      } else if (this.lspClient) {
        await this.lspClient.stopAll();
        lspActions.updateLspStatus("disconnected", []);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Failed to toggle TypeScript LSP:", error);
      const lspActions = useLspStore.getState().actions;
      lspActions.setLspError(`LSP toggle failed: ${errorMessage}`);
    }
  }

  getSettings() {
    return {
      enabled: this.isEnabled,
      maxCompletionItems: 100,
    };
  }

  updateSettings(settings: Record<string, any>) {
    if (typeof settings.enabled === "boolean") {
      this.isEnabled = settings.enabled;
    }
  }
}

// Export the extension instance
export const typescriptLSPExtension = new TypeScriptLSPExtension();
