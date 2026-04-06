export function EditorStylesheet() {
  return (
    <style>
      {`
        /* Font override for editor components */
        .code-editor-font-override {
          font-family: var(--editor-font-family);
        }

        .code-editor-content {
          font-family: inherit;
          background: transparent;
          border: none;
          outline: none;
          color: var(--color-text);
          caret-color: var(--color-text);
          /* Force font loading */
          font-display: swap;
        }
        .code-editor-content:focus {
          outline: none;
        }
        .code-editor-content {
          white-space: pre;
          overflow-wrap: normal;
          word-break: normal;
        }
        /* Simple selection styling */
        .code-editor-content::selection {
          background-color: var(--selection-bg, rgba(0, 123, 255, 0.3));
        }
        .code-editor-content::-moz-selection {
          background-color: var(--selection-bg, rgba(0, 123, 255, 0.3));
        }
        .code-editor-content:empty:before {
          content: attr(data-placeholder);
          color: var(--color-text-lighter);
          pointer-events: none;
        }

        /* Hide scrollbars on line numbers */
        .line-numbers-container {
          scrollbar-width: none;
          -ms-overflow-style: none;
          user-select: none;
          -webkit-user-select: none;
          -moz-user-select: none;
        }
        .line-numbers-container::-webkit-scrollbar {
          display: none;
        }

        /* Hide scrollbars on editor container */
        .editor-container {
          scrollbar-width: none;
          -ms-overflow-style: none;
          /* Avoid forced GPU transforms to prevent subpixel drift */
          will-change: auto;
        }
        .editor-container::-webkit-scrollbar {
          display: none;
        }

        /* Hide scrollbars on passive viewport/content layers */
        .editor-content-new,
        .virtual-editor-container,
        [data-editor-viewport] {
          scrollbar-width: none;
          -ms-overflow-style: none;
          /* Avoid 3D transforms to keep overlay and base layers aligned */
          backface-visibility: visible;
          -webkit-backface-visibility: visible;
        }
        .editor-content-new::-webkit-scrollbar,
        .virtual-editor-container::-webkit-scrollbar,
        [data-editor-viewport]::-webkit-scrollbar {
          display: none;
        }

        /* Optimize line rendering */
        .editor-line-wrapper {
          contain: layout style paint;
          content-visibility: auto;
        }

        /* Ensure line numbers use tabular figures for consistent width */
        .line-numbers-container {
          font-variant-numeric: tabular-nums;
          -webkit-font-feature-settings: "tnum";
          font-feature-settings: "tnum";
        }

        /* Force line numbers font override */
        .line-numbers-container.font-override {
          font-family: var(--editor-font-family) !important;
        }

        /* Platform-specific font rendering */
        :root[data-platform="macos"] .code-editor-content,
        :root[data-platform="macos"] .line-numbers-container {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        :root[data-platform="windows"] .code-editor-content,
        :root[data-platform="windows"] .line-numbers-container,
        :root[data-platform="windows"] .editor-textarea {
          font-variant-ligatures: none;
          font-feature-settings: "liga" 0, "calt" 0, "tnum" 1;
          text-rendering: optimizeSpeed;
        }

        /* Disable selection on breadcrumbs */
        .breadcrumb,
        .breadcrumb-container,
        .breadcrumb-item,
        .breadcrumb-separator {
          user-select: none;
          -webkit-user-select: none;
          -moz-user-select: none;
        }

        /* Search highlighting */
        .search-highlight {
          background-color: rgba(255, 255, 0, 0.3);
        }

        .search-highlight-current {
          background-color: rgba(255, 165, 0, 0.5);
          outline: 1px solid rgba(255, 165, 0, 0.8);
        }

        /* Remove focus rings on all inputs in find bar */
        input[type="text"]:focus {
          outline: none !important;
          box-shadow: none !important;
          border: none !important;
        }

        /* Specifically target find bar input */
        .find-bar input:focus {
          outline: none !important;
          box-shadow: none !important;
          border: none !important;
          ring: none !important;
        }

        /* Remove border radius from find bar */
        .find-bar {
          border-radius: 0 !important;
        }

        .find-bar input {
          border-radius: 0 !important;
        }

        .find-bar button {
          border-radius: 0 !important;
        }

        .folded-preview-line {
          cursor: pointer;
          color: var(--color-text-lighter);
          transition: color 120ms ease;
        }

        .folded-preview-line:hover {
          color: var(--color-text);
        }

        /* Git gutter decorations */
        .editor-gutter {
          position: relative;
        }

        .editor-gutter .line-number {
          color: var(--color-text-lighter, #6b7280);
          font-size: 12px;
          font-family: inherit;
          user-select: none;
          -webkit-user-select: none;
          -moz-user-select: none;
        }

        /* Git gutter indicators base styles - minimal design */
        .gutter-decoration.git-gutter-added,
        .gutter-decoration.git-gutter-modified,
        .gutter-decoration.git-gutter-deleted {
          pointer-events: none;
          transition: all 0.15s ease-out;
          opacity: 0.9;
        }

        /* Git gutter specific colors - improved contrast and consistency */
        .gutter-decoration.git-gutter-added {
          background-color: var(--git-gutter-added, #28a745);
          border: none;
        }

        .gutter-decoration.git-gutter-modified {
          background-color: var(--git-gutter-modified, #fd7e14);
          border: none;
        }

        .gutter-decoration.git-gutter-deleted {
          background-color: var(--git-gutter-deleted, #dc3545);
          border: none;
        }

        /* Subtle hover effects for git gutter */
        .editor-line-wrapper:hover .gutter-decoration.git-gutter-added {
          background-color: var(--git-gutter-added-hover, #32d74b);
          opacity: 1;
        }

        .editor-line-wrapper:hover .gutter-decoration.git-gutter-modified {
          background-color: var(--git-gutter-modified-hover, #ff8c1a);
          opacity: 1;
        }

        .editor-line-wrapper:hover .gutter-decoration.git-gutter-deleted {
          background-color: var(--git-gutter-deleted-hover, #e74c3c);
          opacity: 1;
        }

        /* Dark theme adjustments - improved visibility */
        @media (prefers-color-scheme: dark) {
          :root {
            --git-gutter-added: #238636;
            --git-gutter-modified: #d29922;
            --git-gutter-deleted: #f85149;
            --git-gutter-added-hover: #2ea043;
            --git-gutter-modified-hover: #e2a324;
            --git-gutter-deleted-hover: #ff6b6b;
            --git-gutter-deleted-text: #ffffff;
            --git-gutter-deleted-bg: rgba(248, 81, 73, 0.15);
            --git-gutter-deleted-border: rgba(248, 81, 73, 0.4);
          }

        }

        /* Light theme CSS custom properties */
        @media (prefers-color-scheme: light) {
          :root {
            --git-gutter-added: #28a745;
            --git-gutter-modified: #fd7e14;
            --git-gutter-deleted: #dc3545;
            --git-gutter-added-hover: #32d74b;
            --git-gutter-modified-hover: #ff8c1a;
            --git-gutter-deleted-hover: #e74c3c;
            --git-gutter-deleted-text: #dc3545;
            --git-gutter-deleted-bg: rgba(220, 53, 69, 0.1);
            --git-gutter-deleted-border: rgba(220, 53, 69, 0.3);
          }
        }

        /* Make sure git decorations are visible */
        .editor-gutter-background {
          opacity: 0.3;
          transition: opacity 0.2s ease;
        }

        .editor-line-wrapper:hover .editor-gutter-background {
          opacity: 0.5;
        }

        /* Line wrapper positioning */
        .editor-line-wrapper {
          position: relative;
        }

        /* Simple git gutter fade in animation */
        @keyframes gitGutterFadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 0.9;
          }
        }

        /* Git gutter spacing and animation */
        .gutter-decoration.git-gutter-added,
        .gutter-decoration.git-gutter-modified,
        .gutter-decoration.git-gutter-deleted {
          animation: gitGutterFadeIn 0.15s ease-out;
        }

        /* Ensure proper spacing between git indicators and content */
        .editor-gutter {
          box-sizing: border-box;
        }

        /* Tooltip styling for git gutter */
        .gutter-decoration[title]:hover::after {
          content: attr(title);
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          background: var(--tooltip-bg, rgba(0, 0, 0, 0.9));
          color: var(--tooltip-text, white);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 400;
          white-space: nowrap;
          z-index: 1000;
          pointer-events: none;
          border: 1px solid var(--tooltip-border, rgba(255, 255, 255, 0.1));
        }

        @media (prefers-color-scheme: dark) {
          :root {
            --tooltip-bg: rgba(40, 44, 52, 0.95);
            --tooltip-text: #ffffff;
            --tooltip-border: rgba(255, 255, 255, 0.1);
          }
        }

        @media (prefers-color-scheme: light) {
          :root {
            --tooltip-bg: rgba(0, 0, 0, 0.9);
            --tooltip-text: #ffffff;
            --tooltip-border: rgba(0, 0, 0, 0.1);
          }
        }

        body.selection-scope-active * {
          user-select: none !important;
          -webkit-user-select: none !important;
          -moz-user-select: none !important;
        }

        body.selection-scope-active [data-selection-scope-active="true"],
        body.selection-scope-active [data-selection-scope-active="true"] * {
          user-select: text !important;
          -webkit-user-select: text !important;
          -moz-user-select: text !important;
        }

        .diff-accordion-line {
          display: flex;
          align-items: center;
          min-height: 100%;
          padding: 2px 10px 8px 0;
        }

        .diff-accordion-card {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          min-height: calc(100% - 4px);
          border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
          border-left: none;
          border-radius: 0 10px 10px 0;
          background: color-mix(in srgb, var(--color-secondary-bg, #1f1f1f) 84%, white 16%);
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03), 0 2px 8px rgba(0, 0, 0, 0.04);
          padding: 0 12px;
          color: var(--color-text, #d4d4d4);
        }

        .diff-accordion-gutter-line {
          display: flex;
          align-items: stretch;
        }

        .diff-accordion-gutter-card {
          position: absolute;
          inset: 2px -1px 8px 10px;
          border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
          border-right: none;
          border-radius: 10px 0 0 10px;
          background: color-mix(in srgb, var(--color-secondary-bg, #1f1f1f) 84%, white 16%);
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03), 0 2px 8px rgba(0, 0, 0, 0.04);
          pointer-events: none;
        }

        .diff-accordion-chevron,
        .diff-accordion-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          color: var(--color-text, #d4d4d4);
        }

        .diff-accordion-name {
          color: var(--git-added, #2ea043);
          font-weight: 500;
          flex-shrink: 0;
        }

        .diff-accordion-path {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--color-text-lighter, rgba(255, 255, 255, 0.65));
        }

        .diff-accordion-count {
          margin-left: auto;
          flex-shrink: 0;
          color: var(--color-text-lighter, rgba(255, 255, 255, 0.65));
          font-size: 0.9em;
        }
      `}
    </style>
  );
}
