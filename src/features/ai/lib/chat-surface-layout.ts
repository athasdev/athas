import type { AIChatSurface } from "@/features/ai/types/ai-chat";

interface ChatSurfaceLayout {
  shellMaxWidthClassName: string;
  timelineMaxWidthClassName: string;
  composerMaxWidthClassName: string;
  railContainerClassName: string | null;
  showsSecondaryRail: boolean;
}

export function getChatSurfaceLayout(surface: AIChatSurface): ChatSurfaceLayout {
  if (surface === "harness") {
    return {
      shellMaxWidthClassName: "max-w-[1480px]",
      timelineMaxWidthClassName: "max-w-[980px]",
      composerMaxWidthClassName: "max-w-[1040px]",
      railContainerClassName: "xl:w-[280px]",
      showsSecondaryRail: true,
    };
  }

  return {
    shellMaxWidthClassName: "max-w-none",
    timelineMaxWidthClassName: "max-w-none",
    composerMaxWidthClassName: "max-w-none",
    railContainerClassName: null,
    showsSecondaryRail: false,
  };
}
