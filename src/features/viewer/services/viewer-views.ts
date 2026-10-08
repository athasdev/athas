import { lazy } from "react";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";

const ImageViewer = lazy(() =>
  import("../image/components/image-viewer").then((module) => ({ default: module.ImageViewer })),
);
const PdfViewer = lazy(() =>
  import("../pdf/components/pdf-viewer").then((module) => ({ default: module.PdfViewer })),
);
const BinaryFileViewer = lazy(() =>
  import("../binary/components/binary-file-viewer").then((module) => ({
    default: module.BinaryFileViewer,
  })),
);

export function registerViewerViews() {
  registerPaneView("image", {
    component: ImageViewer,
    getProps: (buffer) => ({ filePath: buffer.path, fileName: buffer.name, bufferId: buffer.id }),
  });
  registerPaneView("pdf", {
    component: PdfViewer,
    getProps: (buffer) => ({ filePath: buffer.path, fileName: buffer.name, bufferId: buffer.id }),
  });
  registerPaneView("binary", {
    component: BinaryFileViewer,
    getProps: (buffer) => ({ filePath: buffer.path, fileName: buffer.name }),
  });
}
