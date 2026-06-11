import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { NavShell, Button, FormField, Card, Badge } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useNavigate } from 'react-router-dom';

type Household = {
  id: string;
  name: string;
  baseCurrency: string;
  monthStartDay: number;
};

type Member = {
  userId: string;
  name: string;
  email: string;
  role: 'owner' | 'member';
  isPrimaryOwner: boolean;
  joinedAt: string;
  lastLoginAt: string | null;
};

type Invite = {
  id: string;
  email: string;
  role: 'owner' | 'member';
  status: string;
  expiresAt: string;
  createdAt: string;
};

type Me = { id: string; email: string; name: string; isSiteAdmin: boolean };

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'];

const AVATAR_COLORS = [
  'bg-blue-600',
  'bg-emerald-600',
  'bg-amber-500',
  'bg-violet-600',
  'bg-rose-500',
];

function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h * 31) + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ name, userId }: { name: string; userId: string }) {
  return (
    <div
      className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 ${avatarColor(userId)}`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export function HouseholdSettingsPage() {
  const { clearTokens } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me') });
  const { data: household, isLoading: householdLoading } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });
  const { data: members = [] } = useQuery({
    queryKey: ['household-members', household?.id],
    queryFn: () => api.get<Member[]>(`/households/${household!.id}/members`),
    enabled: !!household?.id,
  });
  const { data: invites = [], refetch: refetchInvites } = useQuery({
    queryKey: ['household-invites', household?.id],
    queryFn: () => api.get<Invite[]>(`/households/${household!.id}/invites`),
    enabled: !!household?.id,
  });

  const [editName, setEditName] = useState('');
  const [editCurrency, setEditCurrency] = useState('');
  const [editMonthStart, setEditMonthStart] = useState(1);
  const [editMode, setEditMode] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'owner' | 'member'>('member');
  const [inviteError, setInviteError] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  const myMembership = members.find((m) => m.userId === me?.id);
  const isOwner = myMembership?.role === 'owner';

  const updateSettingsMut = useMutation({
    mutationFn: (data: { name: string; baseCurrency: string; monthStartDay: number }) =>
      api.patch(`/households/${household!.id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['household'] });
      setEditMode(false);
      setSettingsError('');
    },
    onError: (err) => {
      setSettingsError(err instanceof ApiException ? err.message : 'Failed to save settings.');
    },
  });

  function startEdit() {
    setEditName(household?.name ?? '');
    setEditCurrency(household?.baseCurrency ?? 'USD');
    setEditMonthStart(household?.monthStartDay ?? 1);
    setEditMode(true);
    setSettingsError('');
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!household) return;
    setInviteError('');
    setInviteLoading(true);
    try {
      await api.post(`/households/${household.id}/invites`, { email: inviteEmail, role: inviteRole });
      setInviteEmail('');
      await refetchInvites();
    } catch (err) {
      setInviteError(err instanceof ApiException ? err.message : 'Failed to send invite.');
    } finally {
      setInviteLoading(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!household) return;
    await api.delete(`/households/${household.id}/invites/${inviteId}`);
    await refetchInvites();
  }

  async function resendInvite(inviteId: string) {
    if (!household) return;
    await api.post(`/households/${household.id}/invites/${inviteId}/resend`, {});
  }

  async function changeRole(userId: string, role: 'owner' | 'member') {
    if (!household) return;
    await api.patch(`/households/${household.id}/members/${userId}`, { role });
    qc.invalidateQueries({ queryKey: ['household-members'] });
  }

  async function removeMember(userId: string) {
    if (!household) return;
    if (!confirm('Remove this member? Their accounts will be detached but not deleted.')) return;
    await api.delete(`/households/${household.id}/members/${userId}`);
    qc.invalidateQueries({ queryKey: ['household-members'] });
  }

  const navItems = [
    { label: 'Dashboard', href: '/dashboard', active: false },
    { label: 'Accounts', href: '/accounts', active: false },
    { label: 'Categories', href: '/categories', active: false },
    { label: 'Household', href: '/settings/household', active: true },
    ...(me?.isSiteAdmin ? [{ label: 'Admin', href: '/admin', active: false }] : []),
  ];

  async function handleSignOut() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    clearTokens();
    navigate('/login');
  }

  if (householdLoading) {
    return <div className="p-8 text-gray-400 text-sm">Loading…</div>;
  }

  if (!household) {
    return (
      <NavShell navItems={navItems} userEmail={me?.email ?? ''} onSignOut={handleSignOut}>
        <div className="p-6">
          <p className="text-gray-600 text-sm">You are not in a household yet.</p>
          <Button className="mt-4" onClick={() => navigate('/onboarding/household')}>
            Create household
          </Button>
        </div>
      </NavShell>
    );
  }

  return (
    <NavShell navItems={navItems} userEmail={me?.email ?? ''} onSignOut={handleSignOut}>
      <div className="p-6 max-w-5xl space-y-5">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">
            Household —{' '}
            <span className="text-gray-600 font-medium">{household.name}</span>
          </h1>
          {isOwner && !editMode && (
            <button
              onClick={startEdit}
              className="text-sm text-blue-600 hover:underline"
            >
              Edit settings
            </button>
          )}
        </div>

        {/* Settings edit panel — inline, owner-only, toggled by "Edit settings" */}
        {editMode && (
          <Card padding="md">
            <p className="text-sm font-semibold text-gray-900 mb-4">Household settings</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateSettingsMut.mutate({
                  name: editName,
                  baseCurrency: editCurrency,
                  monthStartDay: editMonthStart,
                });
              }}
              className="grid grid-cols-1 sm:grid-cols-3 gap-4"
            >
              <FormField
                label="Household name"
                name="name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Base currency</label>
                <select
                  value={editCurrency}
                  onChange={(e) => setEditCurrency(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Month starts on day</label>
                <select
                  value={editMonthStart}
                  onChange={(e) => setEditMonthStart(Number(e.target.value))}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              {settingsError && (
                <p className="text-sm text-red-600 sm:col-span-3">{settingsError}</p>
              )}
              <div className="flex gap-2 sm:col-span-3">
                <Button type="submit" loading={updateSettingsMut.isPending}>Save</Button>
                <Button type="button" variant="secondary" onClick={() => setEditMode(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Two-column layout — members | invite form */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 items-start">

          {/* Members card */}
          <Card padding="none">
            <div className="px-5 pt-4 pb-2">
              <p className="text-sm font-semibold text-gray-900">Members</p>
            </div>
            <div className="divide-y divide-gray-100">
              {members.map((m) => (
                <div key={m.userId} className="flex items-center justify-between px-5 py-3 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={m.name} userId={m.userId} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {m.name}
                        {m.userId === me?.id && (
                          <span className="ml-1 text-gray-400 font-normal text-xs">(you)</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {m.email} · last login:{' '}
                        {m.lastLoginAt
                          ? new Date(m.lastLoginAt).toLocaleDateString()
                          : 'never'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {m.isPrimaryOwner ? (
                      <Badge variant="success">Owner</Badge>
                    ) : isOwner && m.userId !== me?.id ? (
                      <>
                        <select
                          value={m.role}
                          onChange={(e) =>
                            changeRole(m.userId, e.target.value as 'owner' | 'member')
                          }
                          className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700"
                        >
                          <option value="owner">Co-owner</option>
                          <option value="member">Member</option>
                        </select>
                        <button
                          onClick={() => removeMember(m.userId)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <Badge variant={m.role === 'owner' ? 'success' : 'default'}>
                        {m.role === 'owner' ? 'Co-owner' : 'Member'}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}

              {/* Pending invites shown inline */}
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between px-5 py-3 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-gray-100 border border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-sm flex-shrink-0">
                      ?
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {inv.email}
                        <span className="ml-1.5 text-xs font-normal text-gray-400">invited</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        pending · {inv.role === 'owner' ? 'Co-owner' : 'Member'} · last login: never
                      </p>
                    </div>
                  </div>
                  {isOwner && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => resendInvite(inv.id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Resend
                      </button>
                      <button
                        onClick={() => revokeInvite(inv.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Invite form card — owner only */}
          {isOwner && (
            <Card padding="md">
              <p className="text-sm font-semibold text-gray-900 mb-4">Invite someone</p>
              <form onSubmit={sendInvite} className="space-y-4">
                <FormField
                  label="Email"
                  name="inviteEmail"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="name@email.com"
                  required
                />
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'owner' | 'member')}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="owner">Co-owner — full control</option>
                    <option value="member">Member — view + own accounts</option>
                  </select>
                </div>
                {inviteError && <p className="text-sm text-red-600">{inviteError}</p>}
                <Button type="submit" loading={inviteLoading} className="w-full justify-center">
                  Send invite
                </Button>
              </form>
              <div className="mt-4 bg-blue-50 border-l-4 border-blue-300 rounded-r-lg px-3 py-3 text-xs text-gray-700 leading-relaxed">
                <span className="font-semibold">Roles:</span> a co-owner can edit shared budgets,
                invite members, and change settings. A member sees the shared view and manages only
                their own accounts. Each person keeps their own login + MFA.
              </div>
            </Card>
          )}
        </div>
      </div>
    </NavShell>
  );
}
