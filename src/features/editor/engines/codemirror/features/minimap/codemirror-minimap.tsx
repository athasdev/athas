import { Compartment, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { useLayoutEffect } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { type CodeMirrorHost, flushCodeMirrorExtensionBatch } from "../../host";
import { minimap } from "./minimap";

type WindowListener = Parameters<typeof window.addEventListener>;

/**
 * Runs `install` and returns the window listeners it added. The minimap's slider adds `mouseup`
 * and `mousemove` listeners to the window that it never removes (it removes unbound copies), which
 * would keep every closed editor alive; the feature removes them itself.
 */
function captureWindowListeners(install: () => void): WindowListener[] {
  const added: WindowListener[] = [];
  const original = window.addEventListener;
  const ownDescriptor = Object.getOwnPropertyDescriptor(window, "addEventListener");
  Object.defineProperty(window, "addEventListener", {
    configurable: true,
    writable: true,
    value: function (this: Window, ...args: WindowListener) {
      added.push(args);
      return original.apply(this, args);
    },
  });
  try {
    install();
  } finally {
    if (ownDescriptor) Object.defineProperty(window, "addEventListener", ownDescriptor);
    else Reflect.deleteProperty(window, "addEventListener");
  }
  return added;
}

function installMinimap(view: EditorView) {
  const compartment = new Compartment();
  const listeners = captureWindowListeners(() =>
    view.dispatch({ effects: StateEffect.appendConfig.of(compartment.of(minimap)) }),
  );
  return () => {
    if (compartment.get(view.state) !== undefined) {
      view.dispatch({ effects: compartment.reconfigure([]) });
    }
    for (const [type, listener, options] of listeners) {
      window.removeEventListener(type, listener, options);
    }
  };
}

/** Monaco's minimap for CodeMirror, shown while the `showMinimap` setting is on. */
export function CodeMirrorMinimap({ host }: { host: CodeMirrorHost }) {
  const enabled = useSettingsStore((state) => state.settings.showMinimap);
  const { view } = host;

  useLayoutEffect(() => {
    if (!enabled) return;
    flushCodeMirrorExtensionBatch(view);
    return installMinimap(view);
  }, [enabled, view]);

  return null;
}
