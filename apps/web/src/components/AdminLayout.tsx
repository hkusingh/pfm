import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type Me = { id: string; email: string; isSiteAdmin: boolean };

const links = [
  { to: '/admin/invites', label: 'Invitations' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/policy', label: 'Access policy' },
];

export function AdminLayout() {
  const { clearTokens } = useAuth();
  const navigate = useNavigate();

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
  });

  if (isLoading) return null;

  if (!me?.isSiteAdmin) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  async function handleSignOut() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    clearTokens();
    navigate('/');
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">

      {/* Yellow admin banner */}
      <div className="flex items-center justify-between px-6 py-2.5 flex-shrink-0"
        style={{ background: '#FEF08A', borderBottom: '1px solid #EAB308' }}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold" style={{ color: '#713F12' }}>
            ⚠ Admin console — {me.email}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: '#713F12', background: '#FDE047', border: '1px solid #EAB308' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#FACC15')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#FDE047')}
          >
            ← Back to app
          </button>
          <button
            onClick={handleSignOut}
            className="text-sm font-medium transition-colors"
            style={{ color: '#92400E' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#451A03')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#92400E')}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 min-h-0">
        <aside className="w-52 flex-shrink-0 flex flex-col" style={{ background: '#1e293b', borderRight: '1px solid #334155' }}>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-yellow-400 text-slate-900'
                      : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
