import { describe, expect, it, vi } from "vite-plus/test";

const auth = vi.hoisted(() => ({ subscription: null as unknown }));
vi.mock("@/features/auth/stores/auth.store", () => ({
  useAuthStore: { getState: () => ({ subscription: auth.subscription }) },
}));

import { aiCommands } from "../commands/ai-commands";
import { previewCommands } from "../commands/preview-commands";
import type { CommandContext } from "../types/keymaps.types";

const context = {} as CommandContext;
const offered = (id: string) =>
  [...aiCommands, ...previewCommands].find((command) => command.id === id)?.when?.(context);

describe("cloud feature commands", () => {
  it("stay hidden until the server offers the feature", () => {
    auth.subscription = null;
    expect(offered("ai.openCloudAgents")).toBe(false);
    expect(offered("preview.shareLocalServer")).toBe(false);

    auth.subscription = { status: "pro", capabilities: { cloudAgents: true, previews: false } };
    expect(offered("ai.openCloudAgents")).toBe(true);
    expect(offered("preview.shareLocalServer")).toBe(false);

    auth.subscription = { status: "pro", capabilities: { cloudAgents: true, previews: true } };
    expect(offered("preview.shareLocalServer")).toBe(true);
  });
});
