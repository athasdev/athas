import { toast } from "sonner";
import { useDesktopSignInStore } from "../stores/desktop-sign-in.store";

interface UseDesktopSignInOptions {
  apiBase?: string;
  onSuccess?: () => void;
}

export function useDesktopSignIn(options: UseDesktopSignInOptions = {}) {
  const isSigningIn = useDesktopSignInStore((state) => state.isSigningIn);
  const error = useDesktopSignInStore((state) => state.error);
  const actions = useDesktopSignInStore((state) => state.actions);

  const signIn = async () => {
    const completed = await actions.signIn(options.apiBase);
    if (completed) {
      toast.success("Signed in to Athas Desktop.");
      options.onSuccess?.();
    } else {
      const reason = useDesktopSignInStore.getState().error;
      if (reason) {
        toast.error(reason);
        throw new Error(reason);
      }
    }
  };

  return { signIn, isSigningIn, error, cancel: actions.cancel, reopen: actions.reopen };
}
