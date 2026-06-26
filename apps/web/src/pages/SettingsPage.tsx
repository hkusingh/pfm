import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiException } from '../lib/api';

type Me = {
  id: string;
  email: string;
  name: string;
  isSiteAdmin?: boolean;
  mfaMethods?: { type: string; isPrimary: boolean; confirmedAt: string | null }[];
};

type Household = {
  id: string;
  name: string;
  baseCurrency: string;
  monthStartDay: number;
};

const CURRENCIES = [
  { code: 'USD', label: 'USD ($)' },
  { code: 'EUR', label: 'EUR (€)' },
  { code: 'GBP', label: 'GBP (£)' },
  { code: 'INR', label: 'INR (₹)' },
];

// ── Shared field component ────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
const btnPrimary = 'px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const btnGhost = 'px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors';

// ── Card wrapper ──────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}

// ── Profile card ──────────────────────────────────────────────────────────────

function ProfileCard({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [name, setName] = useState(me.name);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setName(me.name); }, [me.name]);

  const initial = name ? name[0].toUpperCase() : me.email[0].toUpperCase();

  const mutation = useMutation({
    mutationFn: () => api.patch('/auth/profile', { name: name.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <Card title="Profile">
      <div className="flex items-center gap-3">
        <span className="flex items-center justify-center w-11 h-11 rounded-full bg-blue-600 text-white text-lg font-bold select-none shrink-0">
          {initial}
        </span>
        <div className="text-sm">
          <p className="font-medium text-gray-900">{name || '—'}</p>
          <p className="text-gray-500">{me.email}</p>
        </div>
      </div>
      <Field label="Full name">
        <input
          className={input}
          value={name}
          onChange={(e) => { setName(e.target.value); setSaved(false); }}
          maxLength={100}
        />
      </Field>
      <Field label="Email">
        <input className={`${input} bg-gray-50 text-gray-500 cursor-default`} value={me.email} readOnly />
      </Field>
      <p className="text-xs text-gray-500">Email cannot be changed in Phase 1.</p>
      <div className="flex items-center gap-3">
        <button
          className={btnPrimary}
          disabled={mutation.isPending || !name.trim() || name.trim() === me.name}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Saving…' : 'Save profile'}
        </button>
        {saved && <span className="text-sm text-green-600 font-medium">Saved!</span>}
        {mutation.isError && <span className="text-sm text-red-600">Failed to save.</span>}
      </div>
    </Card>
  );
}

// ── Login & security card ─────────────────────────────────────────────────────

function SecurityCard() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const clientError =
    newPw && newPw.length < 12 ? 'New password must be at least 12 characters.' :
    newPw && confirm && newPw !== confirm ? 'Passwords do not match.' : '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (clientError) return;
    setStatus('saving');
    setErrorMsg('');
    try {
      await api.patch('/auth/password', { currentPassword: current, newPassword: newPw });
      setStatus('done');
      // Sessions are revoked — redirect to login after a moment
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Failed to update password.';
      setErrorMsg(msg.includes('401') || msg.toLowerCase().includes('current') ? 'Current password is incorrect.' : msg);
      setStatus('error');
    }
  }

  return (
    <Card title="Login & security">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Current password">
          <input className={input} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password">
          <input className={input} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" placeholder="Min. 12 characters" />
        </Field>
        <Field label="Confirm new password">
          <input className={input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" placeholder="Repeat new password" />
        </Field>
        {clientError && <p className="text-sm text-red-600">{clientError}</p>}
        {status === 'error' && <p className="text-sm text-red-600">{errorMsg}</p>}
        {status === 'done' && <p className="text-sm text-green-600 font-medium">Password updated. Signing you out…</p>}
        <button
          type="submit"
          className={btnPrimary}
          disabled={status === 'saving' || !current || !newPw || !confirm || !!clientError}
        >
          {status === 'saving' ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </Card>
  );
}

// ── Two-factor auth card ──────────────────────────────────────────────────────

function MfaCard({ mfaMethods }: { mfaMethods: Me['mfaMethods'] }) {
  const methods = mfaMethods ?? [];
  const confirmed = methods.filter((m) => m.confirmedAt);

  function label(type: string) {
    return type === 'totp' ? 'Google Authenticator' : 'Email code';
  }

  function addedDate(confirmedAt: string) {
    return new Date(confirmedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return (
    <Card title="Two-factor authentication">
      {confirmed.length === 0 ? (
        <p className="text-sm text-gray-500">No MFA methods enrolled yet.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {confirmed.map((m) => (
            <div key={m.type} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {label(m.type)}{' '}
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${m.isPrimary ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {m.isPrimary ? 'Active' : 'Backup'}
                  </span>
                </p>
                <p className="text-xs text-gray-500">
                  {m.isPrimary ? 'Primary' : 'Backup'} · added {addedDate(m.confirmedAt!)}
                </p>
              </div>
              <a href="/mfa/setup" className={btnGhost}>Manage</a>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button className={btnGhost} onClick={() => alert('Recovery codes are shown once at setup. Re-enroll TOTP to generate new ones.')}>
          View recovery codes
        </button>
        {confirmed.length === 0 && (
          <a href="/mfa/setup" className={btnPrimary}>Set up MFA</a>
        )}
      </div>
      <p className="text-xs text-gray-500">
        MFA is required and can't be turned off — only the method can be changed.
      </p>
    </Card>
  );
}

// ── Preferences & data card ───────────────────────────────────────────────────

function PreferencesCard({ household }: { household: Household }) {
  const qc = useQueryClient();
  const [currency, setCurrency] = useState(household.baseCurrency);
  const [monthStart, setMonthStart] = useState(household.monthStartDay);
  const [saved, setSaved] = useState(false);
  const [delConfirm, setDelConfirm] = useState(false);
  const [delEmail, setDelEmail] = useState('');

  useEffect(() => {
    setCurrency(household.baseCurrency);
    setMonthStart(household.monthStartDay);
  }, [household]);

  const prefMutation = useMutation({
    mutationFn: () => api.patch(`/households/${household.id}`, { baseCurrency: currency, monthStartDay: monthStart }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['household'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  async function handleExport() {
    try {
      const data = await api.get('/user/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pfm-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed. Try again.');
    }
  }

  async function handleDelete() {
    try {
      await api.delete('/user', { confirmEmail: delEmail });
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      window.location.href = '/';
    } catch (err) {
      alert(err instanceof ApiException ? err.message : 'Account deletion failed. Try again.');
    }
  }

  const monthStartOptions = [
    { value: 1, label: '1st of the month' },
    { value: 15, label: '15th of the month' },
    { value: 25, label: '25th of the month' },
  ];

  return (
    <Card title="Preferences & data">
      <Field label="Base currency">
        <select className={input} value={currency} onChange={(e) => { setCurrency(e.target.value); setSaved(false); }}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Month starts on">
        <select className={input} value={monthStart} onChange={(e) => { setMonthStart(parseInt(e.target.value)); setSaved(false); }}>
          {monthStartOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <div className="flex items-center gap-3">
        <button
          className={btnPrimary}
          disabled={prefMutation.isPending || (currency === household.baseCurrency && monthStart === household.monthStartDay)}
          onClick={() => prefMutation.mutate()}
        >
          {prefMutation.isPending ? 'Saving…' : 'Save preferences'}
        </button>
        {saved && <span className="text-sm text-green-600 font-medium">Saved!</span>}
      </div>

      <div className="border-t border-gray-100 pt-4 flex gap-2">
        <button className={btnGhost} onClick={handleExport}>Export my data</button>
        <button
          className="px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
          onClick={() => setDelConfirm(true)}
        >
          Delete account
        </button>
      </div>

      {delConfirm && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
          <p className="text-sm font-medium text-red-700">This permanently deletes your account and all data. Type your email to confirm.</p>
          <input
            className={input}
            type="email"
            placeholder="your@email.com"
            value={delEmail}
            onChange={(e) => setDelEmail(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              disabled={!delEmail}
              onClick={handleDelete}
            >
              Permanently delete
            </button>
            <button className={btnGhost} onClick={() => { setDelConfirm(false); setDelEmail(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const navigate = useNavigate();

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
  });

  const { data: household, isError: noHousehold } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });

  useEffect(() => {
    if (noHousehold) navigate('/onboarding/household', { replace: true });
  }, [noHousehold, navigate]);

  if (!me || !household) {
    return <div className="text-sm text-gray-500 p-6">Loading…</div>;
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Row 1: Profile + Login & security */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ProfileCard me={me} />
        <SecurityCard />
      </div>

      {/* Row 2: 2FA + Preferences */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MfaCard mfaMethods={me.mfaMethods} />
        <PreferencesCard household={household} />
      </div>
    </div>
  );
}
