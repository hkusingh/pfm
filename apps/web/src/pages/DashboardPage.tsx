import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { NavShell, Card, CardHeader, CardTitle } from '@pfm/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type Me = { id: string; email: string; emailVerifiedAt: string | null };

const navItems = [{ label: 'Dashboard', href: '/dashboard', active: true }];

export function DashboardPage() {
  const { clearTokens } = useAuth();
  const navigate = useNavigate();

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
  });

  async function handleSignOut() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      // Best-effort — revoke server-side session; don't block UI on failure
      api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    }
    clearTokens();
    navigate('/login');
  }

  return (
    <NavShell
      navItems={navItems}
      userEmail={me?.email ?? ''}
      onSignOut={handleSignOut}
    >
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <Card>
          <CardHeader>
            <CardTitle>Welcome</CardTitle>
          </CardHeader>
          <div className="px-6 pb-6">
            <p className="text-sm text-gray-600">
              Epic 0 foundation is in place. Accounts, transactions, budgets, and more are coming in
              subsequent epics.
            </p>
          </div>
        </Card>
      </div>
    </NavShell>
  );
}
