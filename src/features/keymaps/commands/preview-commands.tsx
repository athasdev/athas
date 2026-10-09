import { hasProductCapability } from "@/features/auth/services/product-capabilities";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { BroadcastIcon } from "@/ui/icons";
import type { Command } from "../types/keymaps.types";

export const previewCommands: Command[] = [
  {
    id: "preview.shareLocalServer",
    title: "Share Local Server",
    category: "Preview",
    description: "Share a dev server on localhost with a temporary preview link",
    icon: <BroadcastIcon />,
    when: () => hasProductCapability(useAuthStore.getState().subscription, "previews"),
    palette: { label: "Preview: Share Local Server" },
    execute: async () => {
      const { usePreviewsStore } = await import("@/features/previews/stores/previews.store");
      usePreviewsStore.getState().actions.openDialog();
    },
  },
];
