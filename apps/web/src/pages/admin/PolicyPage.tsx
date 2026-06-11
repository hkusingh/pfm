import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, Badge } from '@pfm/ui';
import { api } from '../../lib/api';

type RegistrationMode = 'admin_invite' | 'beta_invite' | 'open';
type Policy = { mode: RegistrationMode };

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

  const update = useMutation({
    mutationFn: (mode: RegistrationMode) =>
      api.patch<Policy>('/admin/registration-policy', { mode }),
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
                onChange={() => update.mutate(mode)}
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
    </div>
  );
}
