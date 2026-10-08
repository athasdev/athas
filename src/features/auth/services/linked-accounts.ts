import { useSyncExternalStore } from "react";

/**
 * Accounts on other services linked to the Athas account (GitHub), contributed by the feature
 * that owns the service. The workbench registers them before it renders
 * (`bootstrap/services/register-workbench-contributions.ts`).
 */

export interface LinkedAccountState {
  connected: boolean;
  /** The connected account's login, when the service has reported it. */
  login: string | null;
}

export interface LinkedAccount {
  subscribe: (listener: () => void) => () => void;
  /** Returns the same object until the state changes. */
  getState: () => LinkedAccountState;
  /** Checks the connection again. */
  refresh: () => Promise<void>;
  /** The avatar the service shows for a login. */
  getAvatarUrl: (login: string, size: number) => string | undefined;
}

type LinkedAccountId = "github";

const NOT_LINKED: LinkedAccountState = { connected: false, login: null };
const subscribeToNothing = () => () => {};
const getNotLinked = () => NOT_LINKED;

const linkedAccounts = new Map<LinkedAccountId, LinkedAccount>();

export function registerLinkedAccount(id: LinkedAccountId, account: LinkedAccount) {
  linkedAccounts.set(id, account);
}

export function getLinkedAccount(id: LinkedAccountId): LinkedAccount | undefined {
  return linkedAccounts.get(id);
}

export function useLinkedAccountState(id: LinkedAccountId): LinkedAccountState {
  const account = linkedAccounts.get(id);
  return useSyncExternalStore(
    account?.subscribe ?? subscribeToNothing,
    account?.getState ?? getNotLinked,
    account?.getState ?? getNotLinked,
  );
}
