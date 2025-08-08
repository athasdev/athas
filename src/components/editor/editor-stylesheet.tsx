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

        /* Git gutter indicators base styles */
        .gutter-decoration.git-gutter-added,
        .gutter-decoration.git-gutter-modified,
        .gutter-decoration.git-gutter-deleted {
          border-radius: 2px;
          pointer-events: none;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          opacity: 0.8;
          box-shadow: 0 0 0 rgba(0, 0, 0, 0);
        }

        /* Git gutter specific colors */
        .gutter-decoration.git-gutter-added {
          background-color: #28a745;
          border-left: 1px solid #1e7e34;
        }

        .gutter-decoration.git-gutter-modified {
          background-color: #ffc107;
          border-left: 1px solid #d39e00;
        }

        .gutter-decoration.git-gutter-deleted {
          background-color: #dc3545;
          border-left: 1px solid #bd2130;
        }

        /* Enhanced hover effects for git gutter */
        .editor-line-wrapper:hover .gutter-decoration.git-gutter-added {
          background-color: #34ce57;
          opacity: 1;
          box-shadow: 0 0 6px rgba(40, 167, 69, 0.4);
          transform: scaleX(1.2);
        }

        .editor-line-wrapper:hover .gutter-decoration.git-gutter-modified {
          background-color: #ffce3a;
          opacity: 1;
          box-shadow: 0 0 6px rgba(255, 193, 7, 0.4);
          transform: scaleX(1.2);
        }

        .editor-line-wrapper:hover .gutter-decoration.git-gutter-deleted {
          background-color: #e74c3c;
          opacity: 1;
          box-shadow: 0 0 6px rgba(220, 53, 69, 0.4);
          transform: scaleX(1.2);
        }

        /* Dark theme adjustments */
        @media (prefers-color-scheme: dark) {
          .gutter-decoration.git-gutter-added {
            background-color: #238636;
            border-left-color: #1a6b2b;
          }

          .gutter-decoration.git-gutter-modified {
            background-color: #d29922;
            border-left-color: #b8851c;
          }

          .gutter-decoration.git-gutter-deleted {
            background-color: #da3633;
            border-left-color: #c5302d;
          }

          .editor-line-wrapper:hover .gutter-decoration.git-gutter-added {
            background-color: #2ea043;
            box-shadow: 0 0 8px rgba(35, 134, 54, 0.5);
          }

          .editor-line-wrapper:hover .gutter-decoration.git-gutter-modified {
            background-color: #e2a324;
            box-shadow: 0 0 8px rgba(210, 153, 34, 0.5);
          }

          .editor-line-wrapper:hover .gutter-decoration.git-gutter-deleted {
            background-color: #f85149;
            box-shadow: 0 0 8px rgba(248, 81, 73, 0.5);
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

        /* Git gutter animation keyframes */
        @keyframes gitGutterFadeIn {
          from {
            opacity: 0;
            transform: scaleX(0);
          }
          to {
            opacity: 0.8;
            transform: scaleX(1);
          }
        }

        .gutter-decoration.git-gutter-added,
        .gutter-decoration.git-gutter-modified,
        .gutter-decoration.git-gutter-deleted {
          animation: gitGutterFadeIn 0.3s ease-out;
        }

        /* Tooltip styling for git gutter */
        .gutter-decoration[title]:hover::after {
          content: attr(title);
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: rgba(0, 0, 0, 0.9);
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          white-space: nowrap;
          z-index: 1000;
          pointer-events: none;
        }

        @media (prefers-color-scheme: dark) {
          .gutter-decoration[title]:hover::after {
            background: rgba(255, 255, 255, 0.9);
            color: black;
          }
        }
      `}
    </style>
  );
}
