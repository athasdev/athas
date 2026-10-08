import {
  registerLinkedAccount,
  type LinkedAccountState,
} from "@/features/auth/services/linked-accounts";
import { useGitHubStore } from "../stores/github.store";
import { getGitHubAvatarUrl } from "./github-avatar-url";

let state: LinkedAccountState = { connected: false, login: null };

function getState(): LinkedAccountState {
  const { githubAccountStatus, currentUser } = useGitHubStore.getState();
  const connected = githubAccountStatus === "connected";
  if (state.connected !== connected || state.login !== currentUser) {
    state = { connected, login: currentUser };
  }
  return state;
}

/** Shows the connected GitHub account in the account menu. */
export function registerGitHubLinkedAccount() {
  registerLinkedAccount("github", {
    subscribe: (listener) => useGitHubStore.subscribe(listener),
    getState,
    refresh: () => useGitHubStore.getState().actions.checkAuth(),
    getAvatarUrl: (login, size) => getGitHubAvatarUrl({ login }, size),
  });
}
