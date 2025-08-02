export function EditorStylesheet() {
  return (
    <style>
      {`
        /* Font loading and display rules */
        @font-face {
          font-family: 'JetBrains Mono';
          font-display: swap;
          font-weight: normal;
          font-style: normal;
        }
        @font-face {
          font-family: 'Fira Code';
          font-display: swap;
        }
        @font-face {
          font-family: 'Source Code Pro';
          font-display: swap;
        }
        @font-face {
          font-family: 'Hack';
          font-display: swap;
        }
        @font-face {
          font-family: 'Inconsolata';
          font-display: swap;
        }
        @font-face {
          font-family: 'Ubuntu Mono';
          font-display: swap;
        }
        @font-face {
          font-family: 'Roboto Mono';
          font-display: swap;
        }
        @font-face {
          font-family: 'DejaVu Sans Mono';
          font-display: swap;
        }
        @font-face {
          font-family: 'Liberation Mono';
          font-display: swap;
        }
        @font-face {
          font-family: 'Noto Sans Mono';
          font-display: swap;
        }

        /* Force font override class */
        .code-editor-font-override {
          font-family: var(--editor-font-family) !important;
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
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
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
          /* Font optimization for line numbers */
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        .line-numbers-container::-webkit-scrollbar {
          display: none;
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
      `}
    </style>
  );
}
