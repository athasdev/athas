import { useEffect } from "react";
import { onBeforeLogout } from "@/features/auth/stores/auth.store";
import { closeAllPreviewTunnels, usePreviewsStore } from "../stores/previews.store";
import { ShareLocalServerDialog } from "./share-local-server-dialog";

/** Shows the share dialog and stops this window's previews on sign-out and when it closes. */
export function PreviewsHost() {
  const isDialogOpen = usePreviewsStore.use.isDialogOpen();

  useEffect(() => {
    const stopOnLogout = onBeforeLogout(() => usePreviewsStore.getState().actions.stopAll());
    const stopOnUnload = () => {
      closeAllPreviewTunnels();
      void usePreviewsStore.getState().actions.stopAll();
    };
    window.addEventListener("beforeunload", stopOnUnload);
    return () => {
      stopOnLogout();
      window.removeEventListener("beforeunload", stopOnUnload);
    };
  }, []);

  return isDialogOpen ? <ShareLocalServerDialog /> : null;
}
