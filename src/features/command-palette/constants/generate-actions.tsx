import { SparkleIcon } from "@/ui/icons";
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
      description: "Generate a UI extension with Athas Intelligence",
      icon: <SparkleIcon />,
      category: "Generate",
      action: () => {
        onClose();
        useGenerateStore.getState().actions.openExtensionGeneration();
      },
    },
  ];
}
