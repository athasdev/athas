import { useEffect, useMemo } from "react";
import { useDebuggerStore } from "@/features/debugger/stores/debugger.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import {
  breakpointGutter,
  breakpointHoverLine,
  hasBreakpointMarkers,
  setBreakpoints,
  setHoveredBreakpointLine,
} from "./breakpoints";

/** The debugger's breakpoint gutter for a file editor: click to toggle, hover to preview. */
export function CodeMirrorBreakpoints({ host }: { host: CodeMirrorHost }) {
  const { view, filePath } = host;
  const debuggerEnabled = useSettingsStore((state) => state.settings.coreFeatures.debugger);
  const breakpoints = useDebuggerStore.use.breakpoints();
  const breakpointsForFile = useMemo(
    () => breakpoints.filter((breakpoint) => breakpoint.filePath === filePath),
    [breakpoints, filePath],
  );
  const showGutter =
    debuggerEnabled &&
    Boolean(filePath) &&
    !host.isVirtual &&
    !host.isReadOnly &&
    !host.hasLineNumberMap;

  const extension = useMemo(
    () =>
      showGutter
        ? breakpointGutter((line) =>
            useDebuggerStore.getState().actions.toggleBreakpoint(filePath, line),
          )
        : null,
    [filePath, showGutter],
  );
  useCodeMirrorExtension(view, extension);

  useEffect(() => {
    if (!showGutter) return;
    // A new editor has no breakpoints drawn; a file without any needs no update.
    if (breakpointsForFile.length === 0 && !hasBreakpointMarkers(view.state)) return;
    view.dispatch({ effects: setBreakpoints.of(breakpointsForFile) });
  }, [breakpointsForFile, extension, showGutter, view]);

  useEffect(() => {
    if (!showGutter) return;
    let hovered: number | null = null;
    const setHovered = (line: number | null) => {
      if (line === hovered) return;
      hovered = line;
      view.dispatch({ effects: setHoveredBreakpointLine.of(line) });
    };
    const handleMouseMove = (event: MouseEvent) => setHovered(breakpointHoverLine(view, event));
    const handleMouseLeave = () => setHovered(null);
    view.dom.addEventListener("mousemove", handleMouseMove);
    view.dom.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      view.dom.removeEventListener("mousemove", handleMouseMove);
      view.dom.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [extension, showGutter, view]);

  return null;
}
