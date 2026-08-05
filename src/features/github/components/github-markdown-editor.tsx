import {
  MDXEditor,
  type MDXEditorMethods,
  codeBlockPlugin,
  codeMirrorPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { githubMarkdownEditorPlugin } from "../plugins/github-markdown-editor-plugin";
import { MarkdownFloatingToolbar } from "./github-markdown-editor-controls";
import "../styles/github-markdown-editor.css";

interface GitHubMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  minHeight?: number;
  disabled?: boolean;
}

export function GitHubMarkdownEditor({
  value,
  onChange,
  placeholder = "write a description…",
  autoFocus = false,
  minHeight = 224,
  disabled = false,
}: GitHubMarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const currentValueRef = useRef(value);
  const [editorError, setEditorError] = useState<string | null>(null);
  const plugins = useMemo(
    () => [
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      tablePlugin(),
      imagePlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      codeBlockPlugin({ defaultCodeBlockLanguage: "text" }),
      codeMirrorPlugin({
        codeBlockLanguages: {
          text: "Plain text",
          bash: "Shell",
          css: "CSS",
          html: "HTML",
          javascript: "JavaScript",
          json: "JSON",
          rust: "Rust",
          typescript: "TypeScript",
          tsx: "TypeScript React",
        },
      }),
      markdownShortcutPlugin(),
      githubMarkdownEditorPlugin(),
      toolbarPlugin({ toolbarContents: MarkdownFloatingToolbar }),
    ],
    [],
  );

  useEffect(() => {
    if (value === currentValueRef.current) return;
    currentValueRef.current = value;
    editorRef.current?.setMarkdown(value);
  }, [value]);

  const updateValue = useCallback(
    (nextValue: string) => {
      currentValueRef.current = nextValue;
      setEditorError(null);
      onChange(nextValue);
    },
    [onChange],
  );

  return (
    <section
      className="github-markdown-composer"
      style={
        {
          "--github-markdown-editor-min-height": `${minHeight}px`,
        } as CSSProperties
      }
      aria-label="Markdown editor"
      aria-disabled={disabled}
    >
      {editorError ? (
        <div className="github-markdown-composer-error" role="alert">
          This Markdown needs a small fix before rich text can render it: {editorError}
        </div>
      ) : null}

      <MDXEditor
        ref={editorRef}
        markdown={value}
        onChange={updateValue}
        onError={({ error }) => setEditorError(error)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck
        trim={false}
        readOnly={disabled}
        plugins={plugins}
        className="github-markdown-editor"
        contentEditableClassName="github-markdown-editor-content"
      />
    </section>
  );
}
