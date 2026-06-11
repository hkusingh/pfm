import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, Button, FormField } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { AuthLayout } from '../components/AuthLayout';

type TotpSetup = { secret: string; otpauthUrl: string; qrDataUrl: string };

export function MfaSetupPage() {
  const navigate = useNavigate();
  const [totp, setTotp] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  useEffect(() => {
    api.post<TotpSetup>('/mfa/totp/setup').then(setTotp).catch(console.error);
  }, []);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ recoveryCodes: string[] }>('/mfa/totp/confirm', { code });
      setRecoveryCodes(res.recoveryCodes);
    } catch (err) {
      setError(err instanceof ApiException ? err.message : 'Confirmation failed.');
    } finally {
      setLoading(false);
    }
  }

  if (recoveryCodes.length > 0) {
    return (
      <AuthLayout>
        <Card>
          <CardHeader><CardTitle>Save your recovery codes</CardTitle></CardHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Store these somewhere safe. Each can only be used once if you lose your authenticator.
            </p>
            <div className="bg-gray-100 rounded-lg p-4 font-mono text-sm space-y-1">
              {recoveryCodes.map((c) => <div key={c}>{c}</div>)}
            </div>
            <Button className="w-full" onClick={() => navigate('/login')}>Done — sign in</Button>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader><CardTitle>Set up authenticator app</CardTitle></CardHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Scan the QR code with Google Authenticator, Authy, or any TOTP app, then enter the
            6-digit code to confirm.
          </p>
          {totp ? (
            <>
              <div className="flex justify-center">
                <img src={totp.qrDataUrl} alt="TOTP QR code" className="w-48 h-48 rounded-lg" />
              </div>
              <p className="text-xs text-center text-gray-500">
                Can&apos;t scan?{' '}
                <span className="font-mono select-all break-all">{totp.secret}</span>
              </p>
              <form onSubmit={handleConfirm} className="space-y-4">
                <FormField
                  label="6-digit code" name="code" value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required autoComplete="one-time-code" inputMode="numeric" maxLength={6}
                />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" className="w-full" loading={loading}>Confirm</Button>
              </form>
            </>
          ) : (
            <p className="text-sm text-gray-500">Loading…</p>
          )}
        </div>
      </Card>
    </AuthLayout>
  );
}
