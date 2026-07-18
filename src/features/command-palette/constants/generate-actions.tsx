import { SparkleIcon as Sparkles } from "@/ui/icons";
import { useGenerateStore } from "@/features/generate/stores/generate.store";
import type { Action } from "../types/action.types";

interface GenerateActionsParams {
  onClose: () => void;
}

export function createGenerateActions({ onClose }: GenerateActionsParams): Action[] {
  return [
    {
      id: "generate-extension",
      label: "Generate: Extension",
      description: "Generate a hosted UI extension from a prompt",
      icon: <Sparkles />,
      category: "Generate",
      action: () => {
        onClose();
        useGenerateStore.getState().actions.openExtensionGeneration();
      },
    },
  ];
}
