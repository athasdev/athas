import ProjectTabs from "./project-tabs";
import WindowTitleDisplay from "./window-title-display";

interface TitleBarProjectAreaProps {
  mode: "tabs" | "window";
}

export function TitleBarProjectArea({ mode }: TitleBarProjectAreaProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex h-8 justify-center">
      <div data-title-bar-project-tabs="true" className="pointer-events-auto flex h-8 items-center">
        {mode === "window" ? <WindowTitleDisplay /> : <ProjectTabs />}
      </div>
    </div>
  );
}
