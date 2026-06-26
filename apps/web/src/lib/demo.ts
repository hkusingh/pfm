import { useOutletContext } from 'react-router-dom';

export type AppShellContext = { isDemo: boolean };

/** Use inside any page rendered by AppShell to check demo mode. */
export function useIsDemo(): boolean {
  const ctx = useOutletContext<AppShellContext | undefined>();
  return ctx?.isDemo ?? false;
}
