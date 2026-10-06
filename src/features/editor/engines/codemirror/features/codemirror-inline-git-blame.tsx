import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { InlineGitBlameCard } from "@/features/git/components/inline-git-blame-card";
import { useGitBlame } from "@/features/git/hooks/use-git-blame";
import {
  getInlineGitBlamePresentation,
  type InlineGitBlamePresentation,
} from "@/features/git/utils/git-blame-decoration";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useBufferStore } from "../../../stores/buffer.store";
import { getBufferById } from "../../../utils/buffer-index";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import {
  hasInlineGitBlame,
  INLINE_GIT_BLAME_CLASS,
  inlineGitBlameExtension,
  setInlineGitBlame,
} from "./inline-git-blame";

/** How long the cursor rests on a line before its inline blame appears. */
const INLINE_GIT_BLAME_DELAY_MS = 450;
/** How long the pointer rests on inline blame before its commit card opens. */
const INLINE_GIT_BLAME_CARD_DELAY_MS = 500;
/** How long the commit card stays after the pointer leaves, so it can move onto the card. */
const INLINE_GIT_BLAME_CARD_CLOSE_DELAY_MS = 120;

/** End-of-line blame for the cursor line, with a commit card on hover. */
export function CodeMirrorInlineGitBlame({ host }: { host: CodeMirrorHost }) {
  const { view, container, filePath, bufferId, isActiveSurface } = host;
  const enabled = useSettingsStore((state) => state.settings.enableInlineGitBlame);
  const blameActive = Boolean(isActiveSurface && enabled && filePath);
  // Blame follows unsaved text, but only while it is shown here.
  const content = useBufferStore(
    useCallback(
      (state) => {
        if (!blameActive) return "";
        const found = getBufferById(state.buffers, bufferId);
        return found?.type === "editor" ? found.content : "";
      },
      [blameActive, bufferId],
    ),
  );
  const { getBlameForLine } = useGitBlame(blameActive ? filePath : undefined, content);

  const renderTimerRef = useRef<number | null>(null);
  const renderedKeyRef = useRef<string | null>(null);
  const renderedLineRef = useRef<number | null>(null);
  const presentationRef = useRef<InlineGitBlamePresentation | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [card, setCard] = useState<{
    anchor: HTMLElement;
    presentation: InlineGitBlamePresentation;
  } | null>(null);

  const cancelOpen = useCallback(() => {
    if (openTimerRef.current === null) return;
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const closeCard = useCallback(() => {
    cancelOpen();
    cancelClose();
    setCard(null);
  }, [cancelClose, cancelOpen]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setCard(null);
    }, INLINE_GIT_BLAME_CARD_CLOSE_DELAY_MS);
  }, [cancelClose]);

  const clearBlame = useCallback(() => {
    renderedKeyRef.current = null;
    renderedLineRef.current = null;
    presentationRef.current = null;
    closeCard();
    if (hasInlineGitBlame(view)) view.dispatch({ effects: setInlineGitBlame.of(null) });
  }, [closeCard, view]);

  const renderBlame = useCallback(() => {
    if (!enabled || !isActiveSurface || !filePath) {
      clearBlame();
      return;
    }
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const blameLine = getBlameForLine(line.number - 1);
    const presentation = blameLine ? getInlineGitBlamePresentation(blameLine) : null;
    if (!blameLine || !presentation) {
      clearBlame();
      return;
    }

    presentationRef.current = presentation;
    const key = `${filePath}:${line.number}:${blameLine.commit_hash}:${presentation.text}`;
    if (renderedKeyRef.current === key) return;
    view.dispatch({
      effects: setInlineGitBlame.of({ position: line.to, text: presentation.text, key }),
    });
    renderedKeyRef.current = key;
    renderedLineRef.current = line.number;
  }, [clearBlame, enabled, filePath, getBlameForLine, isActiveSurface, view]);

  const renderBlameRef = useRef(renderBlame);
  useLayoutEffect(() => {
    renderBlameRef.current = renderBlame;
  }, [renderBlame]);

  // Blame waits for the cursor to settle, so moving through a file does not flash a line of
  // metadata on every row it passes. Leaving the blamed line hides it right away.
  const scheduleRender = useCallback(() => {
    const lineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
    if (renderedLineRef.current !== null && renderedLineRef.current !== lineNumber) clearBlame();
    if (renderTimerRef.current !== null) window.clearTimeout(renderTimerRef.current);
    renderTimerRef.current = window.setTimeout(() => {
      renderTimerRef.current = null;
      renderBlameRef.current();
    }, INLINE_GIT_BLAME_DELAY_MS);
  }, [clearBlame, view]);

  const scheduleRenderRef = useRef(scheduleRender);
  useLayoutEffect(() => {
    scheduleRenderRef.current = scheduleRender;
  }, [scheduleRender]);

  const extension = useMemo(() => inlineGitBlameExtension(() => scheduleRenderRef.current()), []);
  useCodeMirrorExtension(view, extension);

  useEffect(() => {
    scheduleRender();
  }, [renderBlame, scheduleRender]);

  useEffect(() => {
    const getAnchor = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>(`.${INLINE_GIT_BLAME_CLASS}`) : null;
    const showCard = (event: Event) => {
      const anchor = getAnchor(event.target);
      const presentation = presentationRef.current;
      if (!anchor || !presentation || !container.contains(anchor)) return;
      cancelClose();
      cancelOpen();
      // Opens only once the pointer rests on the blame, not while it passes over it.
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        if (!anchor.isConnected) return;
        setCard((current) =>
          current?.anchor === anchor && current.presentation === presentation
            ? current
            : { anchor, presentation },
        );
      }, INLINE_GIT_BLAME_CARD_DELAY_MS);
    };
    const hideCard = (event: Event) => {
      const anchor = getAnchor(event.target);
      if (!anchor) return;
      const relatedTarget = event instanceof MouseEvent ? event.relatedTarget : null;
      if (relatedTarget instanceof Node && anchor.contains(relatedTarget)) return;
      cancelOpen();
      scheduleClose();
    };
    container.addEventListener("mouseover", showCard, true);
    container.addEventListener("mouseout", hideCard, true);
    return () => {
      container.removeEventListener("mouseover", showCard, true);
      container.removeEventListener("mouseout", hideCard, true);
    };
  }, [cancelClose, cancelOpen, container, scheduleClose]);

  useEffect(
    () => () => {
      if (renderTimerRef.current !== null) window.clearTimeout(renderTimerRef.current);
      renderTimerRef.current = null;
      if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      renderedKeyRef.current = null;
      renderedLineRef.current = null;
      presentationRef.current = null;
    },
    [view],
  );

  if (!card) return null;

  return (
    <InlineGitBlameCard
      anchor={card.anchor}
      presentation={card.presentation}
      onClose={closeCard}
      onPointerEnter={cancelClose}
      onPointerLeave={scheduleClose}
    />
  );
}
