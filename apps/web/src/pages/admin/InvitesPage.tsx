import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, FormField, Card, CardHeader, CardTitle, Badge } from '@pfm/ui';
import { api, ApiException } from '../../lib/api';

type Invite = {
  id: string;
  email: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  issuedByAdmin: { email: string };
};

function inviteStatus(invite: Invite): { label: string; variant: 'success' | 'default' | 'danger' | 'warning' } {
  if (invite.usedAt) return { label: 'Accepted', variant: 'success' };
  if (new Date(invite.expiresAt) < new Date()) return { label: 'Expired', variant: 'danger' };
  return { label: 'Pending', variant: 'warning' };
}

export function InvitesPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState('');

  const { data: invites = [], isLoading } = useQuery({
    queryKey: ['admin', 'invites'],
    queryFn: () => api.get<Invite[]>('/admin/signup-invites'),
  });

  const [inviteUrl, setInviteUrl] = useState('');

  const create = useMutation({
    mutationFn: (email: string) => api.post<{ id: string; signupUrl: string }>('/admin/signup-invites', { email }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin', 'invites'] });
      setEmail('');
      setFormError('');
      setInviteUrl(res.signupUrl);
    },
    onError: (err) => setFormError(err instanceof ApiException ? err.message : 'Failed to send invite'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/signup-invites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'invites'] }),
  });

  const resend = useMutation({
    mutationFn: (id: string) => api.post(`/admin/signup-invites/${id}/resend`, {}),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    create.mutate(email);
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <h1 className="text-2xl font-semibold text-gray-900">Invitations</h1>

      {/* New invite form */}
      <Card>
        <CardHeader><CardTitle>Send invitation</CardTitle></CardHeader>
        <form onSubmit={handleCreate} className="flex gap-3 items-end">
          <div className="flex-1">
            <FormField
              label="Email address"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <Button type="submit" loading={create.isPending}>Send invite</Button>
        </form>
        {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}
        {create.isSuccess && inviteUrl && (
          <div className="mt-3 rounded-lg bg-green-50 border border-green-200 p-3 space-y-1">
            <p className="text-sm font-medium text-green-800">Invite created — share this link:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-green-700 break-all">{inviteUrl}</code>
              <button
                type="button"
                className="shrink-0 text-xs text-green-700 underline hover:text-green-900"
                onClick={() => navigator.clipboard.writeText(inviteUrl)}
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-green-600">An invite email was also attempted — check server logs if it didn't arrive.</p>
          </div>
        )}
      </Card>

      {/* Invite list */}
      <Card>
        <CardHeader><CardTitle>All invitations</CardTitle></CardHeader>
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="text-sm text-gray-500">No invitations yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="px-6 py-2 font-medium text-gray-500">Email</th>
                  <th className="px-6 py-2 font-medium text-gray-500">Status</th>
                  <th className="px-6 py-2 font-medium text-gray-500">Expires</th>
                  <th className="px-6 py-2 font-medium text-gray-500">Invited by</th>
                  <th className="px-6 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invites.map((inv) => {
                  const { label, variant } = inviteStatus(inv);
                  const isPending = !inv.usedAt && new Date(inv.expiresAt) > new Date();
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium">{inv.email}</td>
                      <td className="px-6 py-3"><Badge variant={variant}>{label}</Badge></td>
                      <td className="px-6 py-3 text-gray-500">
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-3 text-gray-500">{inv.issuedByAdmin.email}</td>
                      <td className="px-6 py-3 text-right space-x-2">
                        {isPending && (
                          <>
                            <button
                              className="text-xs text-blue-600 hover:underline"
                              onClick={() => resend.mutate(inv.id)}
                            >
                              Resend
                            </button>
                            <button
                              className="text-xs text-red-600 hover:underline"
                              onClick={() => revoke.mutate(inv.id)}
                            >
                              Revoke
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
