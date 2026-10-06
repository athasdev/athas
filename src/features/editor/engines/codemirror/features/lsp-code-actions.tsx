import { EditorView } from "@codemirror/view";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import type { DiagnosticCodeAction } from "@/features/diagnostics/types/diagnostics.types";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { LightbulbIcon } from "@/ui/icons";
import { LspClient } from "../../../lsp/lsp-client";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { groupCodeActions } from "../navigation/code-action-groups";
import { toLspPosition } from "../navigation/lsp-document";
import { useLspRevision } from "./lsp-feature-utils";

const REFRESH_DELAY_MS = 250;
const NO_DIAGNOSTICS: never[] = [];

interface Lightbulb {
  /** One-based document line the actions were asked for. */
  line: number;
  actions: DiagnosticCodeAction[];
}

interface Placement {
  top: number;
  left: number;
  height: number;
}

/**
 * The code action lightbulb: shown at the start of the cursor's line whenever the language server
 * has actions for the selection (and the diagnostics it touches), with a menu that applies the
 * chosen action's edits and runs its command, as Monaco's lightbulb did.
 */
export function CodeMirrorCodeActions({ host }: { host: CodeMirrorHost }) {
  const { view, filePath, container } = host;
  const revision = useLspRevision();
  const diagnostics = useDiagnosticsStore(
    (state) => state.diagnosticsByFile.get(filePath) ?? NO_DIAGNOSTICS,
  );
  // Selection changes ask for a debounced refresh directly, without a render per keystroke.
  const scheduleRefreshRef = useRef<() => void>(() => {});
  const [lightbulb, setLightbulb] = useState<Lightbulb | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const lightbulbRef = useRef(lightbulb);
  lightbulbRef.current = lightbulb;

  const measure = useCallback(() => {
    const current = lightbulbRef.current;
    if (!current) {
      setPlacement(null);
      return;
    }
    view.requestMeasure({
      read: () => {
        const { doc } = view.state;
        if (current.line > doc.lines) return null;
        const block = view.lineBlockAt(doc.line(current.line).from);
        const containerRect = container.getBoundingClientRect();
        const scrollRect = view.scrollDOM.getBoundingClientRect();
        const top = block.top + view.documentTop - containerRect.top;
        const visibleTop = scrollRect.top - containerRect.top;
        const visibleBottom = scrollRect.bottom - containerRect.top;
        if (top + block.height <= visibleTop || top >= visibleBottom) return null;
        return { top, left: scrollRect.left - containerRect.left, height: block.height };
      },
      write: (next) => {
        setPlacement((previous) =>
          previous &&
          next &&
          previous.top === next.top &&
          previous.left === next.left &&
          previous.height === next.height
            ? previous
            : next,
        );
      },
    });
  }, [container, view]);

  const extension = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          const line = update.state.doc.lineAt(update.state.selection.main.head).number;
          if (lightbulbRef.current && lightbulbRef.current.line !== line) setLightbulb(null);
          scheduleRefreshRef.current();
        }
        if (update.geometryChanged || update.viewportChanged || update.heightChanged) measure();
      }),
    [measure],
  );
  useCodeMirrorExtension(view, extension);

  useEffect(() => {
    const scroller = view.scrollDOM;
    scroller.addEventListener("scroll", measure, { passive: true });
    return () => scroller.removeEventListener("scroll", measure);
  }, [measure, view]);

  useEffect(measure, [lightbulb, measure]);

  useEffect(() => {
    if (menuOpen) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let latestRequest = 0;
    const refresh = () => {
      const request = ++latestRequest;
      const client = LspClient.getInstance();
      if (!client.isDocumentOpen(filePath)) return;
      const { state } = view;
      const { main } = state.selection;
      const start = toLspPosition(state.doc, main.from);
      const end = toLspPosition(state.doc, main.to);
      const touching = diagnostics.filter(
        (diagnostic) => diagnostic.line <= end.line && diagnostic.endLine >= start.line,
      );
      void client
        .getCodeActions(
          filePath,
          {
            startLine: start.line,
            startColumn: start.character,
            endLine: end.line,
            endColumn: end.character,
          },
          touching,
        )
        .then((actions) => {
          if (cancelled || request !== latestRequest || view.state.doc !== state.doc) return;
          const enabled = actions.filter((action) => !action.disabledReason);
          setLightbulb(
            enabled.length > 0
              ? { line: state.doc.lineAt(main.head).number, actions: enabled }
              : null,
          );
        });
    };
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(refresh, REFRESH_DELAY_MS);
    };
    scheduleRefreshRef.current = schedule;
    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      scheduleRefreshRef.current = () => {};
    };
  }, [diagnostics, filePath, menuOpen, revision, view]);

  const groups = useMemo(() => groupCodeActions(lightbulb?.actions ?? []), [lightbulb]);

  const apply = (action: DiagnosticCodeAction) => {
    void LspClient.getInstance()
      .applyCodeAction(filePath, action.payload)
      .then((result) => {
        if (!result.applied) toast.error(result.reason || `Failed to run ${action.title}`);
        else if (result.reason) toast.warning(result.reason);
      });
    view.focus();
  };

  if (!lightbulb || !placement || groups.length === 0) return null;
  const hasQuickFix = groups[0]?.id === "quickfix";

  return (
    <div
      className="absolute z-10 flex items-center"
      data-slot="codemirror-code-actions"
      style={{ top: placement.top, left: placement.left, height: placement.height }}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="inline"
              iconOnly
              tone={hasQuickFix ? "warning" : "default"}
              aria-label="Show code actions"
            />
          }
        >
          <LightbulbIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" size="wide" viewport="list">
          {groups.map((group, index) => (
            <Fragment key={group.id}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                {group.actions.map((action) => (
                  <DropdownMenuItem key={action.id} onClick={() => apply(action)}>
                    <span className="min-w-0 flex-1 truncate">{action.title}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
