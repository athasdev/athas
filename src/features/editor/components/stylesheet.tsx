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

        body.selection-scope-active
          [data-selection-scope-active="true"]
          [data-selection-scope-exclude="true"],
        body.selection-scope-active
          [data-selection-scope-active="true"]
          [data-selection-scope-exclude="true"] * {
          user-select: none !important;
          -webkit-user-select: none !important;
          -moz-user-select: none !important;
        }
      `}
    </style>
  );
}
