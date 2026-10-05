import { useMemo } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../../host";
import { stickyScroll } from "./sticky-scroll";

/** Monaco's sticky scroll for CodeMirror, shown while the `editorStickyScroll` setting is on. */
export function CodeMirrorStickyScroll({ host }: { host: CodeMirrorHost }) {
  const enabled = useSettingsStore((state) => state.settings.editorStickyScroll);
  const extension = useMemo(() => (enabled ? stickyScroll() : null), [enabled]);
  useCodeMirrorExtension(host.view, extension);
  return null;
}
