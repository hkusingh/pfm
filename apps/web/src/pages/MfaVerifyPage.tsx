import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, CardHeader, CardTitle, Button, FormField } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuthLayout } from '../components/AuthLayout';

export function MfaVerifyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setTokens } = useAuth();
  const state = location.state as { mfaChallengeToken?: string; householdInvite?: string } | null;
  const mfaChallengeToken = state?.mfaChallengeToken;
  const householdInvite = state?.householdInvite;

  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!mfaChallengeToken) {
    navigate('/login', { replace: true });
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ accessToken: string; refreshToken: string; deviceToken?: string }>(
        '/mfa/verify',
        { mfaChallengeToken, code, trustDevice },
      );
      if (res.deviceToken) {
        localStorage.setItem('deviceToken', res.deviceToken);
      }
      setTokens(res.accessToken, res.refreshToken);
      navigate(householdInvite ? `/invites/${householdInvite}` : '/dashboard');
    } catch (err) {
      setError(err instanceof ApiException ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader><CardTitle>Two-factor authentication</CardTitle></CardHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-600">Enter the 6-digit code from your authenticator.</p>
          <FormField
            label="Code" name="code" value={code}
            onChange={(e) => setCode(e.target.value)}
            required autoComplete="one-time-code" inputMode="numeric" maxLength={6}
          />
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              className="rounded border-gray-300 text-blue-600"
            />
            <span className="text-sm text-gray-600">Trust this device for 30 days</span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>Verify</Button>
        </form>
      </Card>
    </AuthLayout>
  );
}
