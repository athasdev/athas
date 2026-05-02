import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorLayout } from "@/features/editor/hooks/use-layout";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import type { Position } from "../types/editor";
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

const DEFAULT_TRIGGER_CHARS = ["(", ","];

interface SignatureHelpTooltipProps {
  editorRef: RefObject<HTMLDivElement | null>;
  filePath: string | undefined;
  cursorPosition: Position;
}

export const SignatureHelpTooltip = ({
  editorRef,
  filePath,
  cursorPosition,
}: SignatureHelpTooltipProps) => {
  const [signatureHelp, setSignatureHelp] = useState<SignatureHelpResult | null>(null);
  const { charWidth, lineHeight } = useEditorLayout();
  const lastInputTimestamp = useEditorUIStore.use.lastInputTimestamp();
  const requestIdRef = useRef(0);
  const scrollOffsetRef = useRef({ top: 0, left: 0 });
  const [triggerCharacters, setTriggerCharacters] = useState(DEFAULT_TRIGGER_CHARS);

  // Track scroll position
  useEffect(() => {
    const textarea = editorRef.current?.querySelector("textarea");
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
  }, [editorRef, filePath]);

  useEffect(() => {
    if (!filePath || !extensionRegistry.isLspSupported(filePath)) {
      setTriggerCharacters(DEFAULT_TRIGGER_CHARS);
      return;
    }

    let cancelled = false;
    const lspClient = LspClient.getInstance();

    lspClient.getSignatureTriggerCharacters(filePath).then((characters) => {
      if (cancelled) return;
      setTriggerCharacters(characters.length > 0 ? characters : DEFAULT_TRIGGER_CHARS);
    });

    return () => {
      cancelled = true;
    };
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
    const textarea = editorRef.current?.querySelector("textarea");
    if (!textarea) return;

    const content = textarea.value;
    const offset = cursorPosition.offset;
    if (offset <= 0) return;

    const charBefore = content[offset - 1];
    if (triggerCharacters.includes(charBefore)) {
      void fetchSignatureHelp();
    } else if (charBefore === ")") {
      setSignatureHelp(null);
    }
  }, [editorRef, lastInputTimestamp, cursorPosition.offset, fetchSignatureHelp, triggerCharacters]);

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
    return {
      top:
        EDITOR_CONSTANTS.EDITOR_PADDING_TOP +
        cursorPosition.line * lineHeight -
        scrollOffsetRef.current.top -
        lineHeight -
        8,
      left:
        EDITOR_CONSTANTS.EDITOR_PADDING_LEFT +
        cursorPosition.column * charWidth -
        scrollOffsetRef.current.left,
    };
  }, [cursorPosition.line, cursorPosition.column, charWidth, lineHeight]);

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
        top: `${Math.max(4, position.top)}px`,
        left: `${Math.max(EDITOR_CONSTANTS.EDITOR_PADDING_LEFT, position.left)}px`,
      }}
    >
      <div className="ui-font ui-text-sm editor-font text-text">{renderLabel()}</div>
    </div>
  );
};
