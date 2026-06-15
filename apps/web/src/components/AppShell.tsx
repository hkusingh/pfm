import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { NavShell } from '@pfm/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type Me = { id: string; email: string; name: string; isSiteAdmin: boolean };
type Household = { id: string; name: string };
type TxListMeta = { items: unknown[]; total: number };
type Member = { id: string };

export function AppShell() {
  const { clearTokens } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me') });
  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
    retry: false,
  });
  const { data: members } = useQuery({
    queryKey: ['household-members', household?.id],
    queryFn: () => api.get<Member[]>(`/households/${household!.id}/members`),
    enabled: !!household?.id,
  });
  const { data: uncatMeta } = useQuery({
    queryKey: ['uncategorized-count', household?.id],
    queryFn: () =>
      api.get<TxListMeta>(`/households/${household!.id}/transactions?categoryId=uncategorized&limit=1`),
    enabled: !!household?.id,
  });

  const uncategorizedCount = uncatMeta?.total ?? 0;

  const navItems = [
    { label: 'Dashboard', href: '/dashboard', active: pathname === '/dashboard' },
    {
      label: 'Transactions',
      href: '/transactions',
      active: pathname.startsWith('/transactions'),
      badge: uncategorizedCount,
    },
    { label: 'Accounts', href: '/accounts', active: pathname === '/accounts' },
    { label: 'Categories', href: '/categories', active: pathname === '/categories' },
    { label: 'Budgets', href: '/budgets', active: pathname === '/budgets' },
    { label: 'Reports', href: '/reports', active: pathname === '/reports' },
    { label: 'Household', href: '/settings/household', active: pathname === '/settings/household' },
    ...(me?.isSiteAdmin
      ? [{ label: 'Admin', href: '/admin/invites', active: pathname.startsWith('/admin') }]
      : []),
  ];

  const userInitial = me?.name
    ? me.name[0].toUpperCase()
    : me?.email
    ? me.email[0].toUpperCase()
    : undefined;

  async function handleSignOut() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    clearTokens();
    navigate('/login');
  }

  return (
    <NavShell
      navItems={navItems}
      userEmail={me?.email ?? ''}
      userInitial={userInitial}
      householdName={household?.name}
      memberCount={members?.length}
      onSignOut={handleSignOut}
      onNavigate={(href) => navigate(href)}
    >
      <Outlet />
    </NavShell>
  );
}
