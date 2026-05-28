export function EditorStylesheet() {
  return (
    <style>
      {`
        /* Hide scrollbars on editor container */
        .editor-container {
          scrollbar-width: none;
          -ms-overflow-style: none;
          will-change: auto;
        }
        .editor-container::-webkit-scrollbar {
          display: none;
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
      `}
    </style>
  );
}
