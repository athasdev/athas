import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorLayout } from "@/features/editor/hooks/use-layout";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { LspClient } from "./lsp-client";

interface SignatureInfo {
  label: string;
  documentation?: { kind: string; value: string } | string;
  parameters?: {
    label: string | [number, number];
    documentation?: { kind: string; value: string } | string;
  }[];
  activeParameter?: number;
}

interface SignatureHelpResult {
  signatures: SignatureInfo[];
  activeSignature?: number;
  activeParameter?: number;
}

const TRIGGER_CHARS = ["(", ","];

export const SignatureHelpTooltip = () => {
  const [signatureHelp, setSignatureHelp] = useState<SignatureHelpResult | null>(null);
  const { charWidth } = useEditorLayout();
  const cursorPosition = useEditorStateStore.use.cursorPosition();
  const filePath = useEditorStateStore.use.filePath();
  const lastInputTimestamp = useEditorUIStore.use.lastInputTimestamp();
  const requestIdRef = useRef(0);
  const scrollOffsetRef = useRef({ top: 0, left: 0 });

  // Track scroll position
  useEffect(() => {
    const editorContainer = document.querySelector(".editor-container");
    const textarea = editorContainer?.querySelector("textarea");
    if (!textarea) return;

    const handleScroll = () => {
      scrollOffsetRef.current = {
        top: textarea.scrollTop,
        left: textarea.scrollLeft,
      };
    };

    textarea.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => textarea.removeEventListener("scroll", handleScroll);
  }, [filePath]);

  const fetchSignatureHelp = useCallback(async () => {
    if (!filePath || !extensionRegistry.isLspSupported(filePath)) {
      setSignatureHelp(null);
      return;
    }

    const id = ++requestIdRef.current;
    const lspClient = LspClient.getInstance();
    const result = await lspClient.getSignatureHelp(
      filePath,
      cursorPosition.line,
      cursorPosition.column,
    );

    if (id !== requestIdRef.current) return;

    if (result && result.signatures.length > 0) {
      setSignatureHelp(result);
    } else {
      setSignatureHelp(null);
    }
  }, [filePath, cursorPosition.line, cursorPosition.column]);

  // Trigger on typing
  useEffect(() => {
    if (lastInputTimestamp === 0) return;

    // Check if the character just typed is a trigger character
    const lines = document.querySelector(
      ".editor-container textarea",
    ) as HTMLTextAreaElement | null;
    if (!lines) return;

    const content = lines.value;
    const offset = cursorPosition.offset;
    if (offset <= 0) return;

    const charBefore = content[offset - 1];
    if (TRIGGER_CHARS.includes(charBefore)) {
      void fetchSignatureHelp();
    } else if (charBefore === ")") {
      setSignatureHelp(null);
    }
  }, [lastInputTimestamp, cursorPosition.offset, fetchSignatureHelp]);

  // Hide on cursor navigation (no typing)
  useEffect(() => {
    if (!signatureHelp) return;
    // When cursor moves without typing, hide the tooltip
    const timeout = setTimeout(() => {
      void fetchSignatureHelp();
    }, 100);
    return () => clearTimeout(timeout);
  }, [cursorPosition.offset, signatureHelp, fetchSignatureHelp]);

  const position = useMemo(() => {
    const fontSize = useEditorSettingsStore.getState().fontSize;
    const lineHeight = Math.ceil((fontSize || 14) * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER);

    return {
      top:
        EDITOR_CONSTANTS.EDITOR_PADDING_TOP +
        cursorPosition.line * lineHeight -
        scrollOffsetRef.current.top -
        4,
      left:
        EDITOR_CONSTANTS.EDITOR_PADDING_LEFT +
        cursorPosition.column * charWidth -
        scrollOffsetRef.current.left,
    };
  }, [cursorPosition.line, cursorPosition.column, charWidth]);

  if (!signatureHelp || signatureHelp.signatures.length === 0) return null;

  const activeIdx = signatureHelp.activeSignature ?? 0;
  const signature = signatureHelp.signatures[activeIdx];
  if (!signature) return null;

  const activeParam = signatureHelp.activeParameter ?? signature.activeParameter ?? 0;

  // Render signature label with active parameter highlighted
  const renderLabel = () => {
    if (!signature.parameters || signature.parameters.length === 0) {
      return <span>{signature.label}</span>;
    }

    const param = signature.parameters[activeParam];
    if (!param) return <span>{signature.label}</span>;

    if (Array.isArray(param.label)) {
      const [start, end] = param.label;
      return (
        <span>
          {signature.label.slice(0, start)}
          <span className="font-bold text-accent">{signature.label.slice(start, end)}</span>
          {signature.label.slice(end)}
        </span>
      );
    }

    // String label — find it in the signature label
    const paramStr = param.label;
    const idx = signature.label.indexOf(paramStr);
    if (idx === -1) return <span>{signature.label}</span>;

    return (
      <span>
        {signature.label.slice(0, idx)}
        <span className="font-bold text-accent">{paramStr}</span>
        {signature.label.slice(idx + paramStr.length)}
      </span>
    );
  };

  return (
    <div
      className="absolute z-50 max-w-md rounded-md border border-border/70 bg-secondary-bg px-2.5 py-1.5 shadow-lg"
      style={{
        bottom: `calc(100% - ${position.top}px)`,
        left: `${position.left}px`,
        transform: "translateY(-4px)",
      }}
    >
      <div className="ui-font ui-text-sm font-mono text-text">{renderLabel()}</div>
    </div>
  );
};
