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
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-slate-900 text-white flex flex-col">
        <div className="h-14 flex items-center px-5 border-b border-slate-700">
          <span className="font-bold text-sm tracking-wide text-slate-300 uppercase">Admin</span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-slate-700">
          <p className="text-xs text-slate-500 truncate">{me.email}</p>
          <button
            onClick={handleSignOut}
            className="mt-1 text-xs text-slate-500 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
