import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, Badge } from '@pfm/ui';
import { api } from '../../lib/api';

type RegistrationMode = 'admin_invite' | 'beta_invite' | 'open';
type Policy = { mode: RegistrationMode; householdInviteQuota: number };

const modeLabels: Record<RegistrationMode, string> = {
  admin_invite: 'Invite only',
  beta_invite: 'Beta (invite or waitlist)',
  open: 'Open signup',
};

const modeDescriptions: Record<RegistrationMode, string> = {
  admin_invite: 'Only users with a valid admin-issued invitation can sign up.',
  beta_invite: 'Users can sign up with an invite or join via waitlist.',
  open: 'Anyone can create an account without an invitation.',
};

const modeVariants: Record<RegistrationMode, 'danger' | 'warning' | 'success'> = {
  admin_invite: 'danger',
  beta_invite: 'warning',
  open: 'success',
};

const allModes: RegistrationMode[] = ['admin_invite', 'beta_invite', 'open'];

export function PolicyPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'policy'],
    queryFn: () => api.get<Policy>('/admin/registration-policy'),
  });

  const [quota, setQuota] = useState(5);

  useEffect(() => {
    if (data?.householdInviteQuota !== undefined) setQuota(data.householdInviteQuota);
  }, [data?.householdInviteQuota]);

  const update = useMutation({
    mutationFn: (payload: { mode: RegistrationMode; householdInviteQuota?: number }) =>
      api.patch<Policy>('/admin/registration-policy', payload),
    onSuccess: (updated) => {
      qc.setQueryData(['admin', 'policy'], updated);
    },
  });

  if (isLoading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;

  const current = data?.mode;

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold text-gray-900">Access policy</h1>

      <Card>
        <CardHeader>
          <CardTitle>Registration mode</CardTitle>
          {current && (
            <Badge variant={modeVariants[current]}>{modeLabels[current]}</Badge>
          )}
        </CardHeader>
        <p className="text-sm text-gray-500 mb-4">
          Controls who can create a new account. Changes take effect immediately.
        </p>
        <div className="space-y-3">
          {allModes.map((mode) => (
            <label
              key={mode}
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                current === mode
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="mode"
                value={mode}
                checked={current === mode}
                onChange={() => update.mutate({ mode })}
                className="mt-0.5"
                disabled={update.isPending}
              />
              <div>
                <p className="text-sm font-medium text-gray-900">{modeLabels[mode]}</p>
                <p className="text-xs text-gray-500 mt-0.5">{modeDescriptions[mode]}</p>
              </div>
            </label>
          ))}
        </div>
        {update.isPending && (
          <p className="mt-3 text-xs text-gray-400">Saving…</p>
        )}
        {update.isSuccess && (
          <p className="mt-3 text-xs text-green-600">Policy updated.</p>
        )}
        {update.isError && (
          <p className="mt-3 text-xs text-red-600">Failed to update policy.</p>
        )}
      </Card>

      {/* Household invite quota — only relevant in beta_invite mode */}
      <Card>
        <CardHeader>
          <CardTitle>Household invite quota</CardTitle>
          {current !== 'beta_invite' && (
            <Badge variant="default">Beta mode only</Badge>
          )}
        </CardHeader>
        <p className="text-sm text-gray-500 mb-4">
          Maximum pending invites a household can have active at once in <strong>Beta</strong> mode.
          A slot reopens when an invite is accepted or expires.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ mode: current!, householdInviteQuota: quota });
          }}
          className="flex items-center gap-3"
        >
          <input
            type="number"
            min={1}
            max={50}
            value={quota}
            onChange={(e) => setQuota(Number(e.target.value))}
            disabled={current !== 'beta_invite'}
            className="w-20 h-[38px] rounded-lg border border-gray-300 px-3 text-sm disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            type="submit"
            disabled={current !== 'beta_invite' || update.isPending}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save quota
          </button>
          <span className="text-xs text-gray-400">current: {data?.householdInviteQuota ?? 5}</span>
        </form>
      </Card>
    </div>
  );
}
