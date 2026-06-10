import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, CardHeader, CardTitle, Button, FormField } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { useAuth } from '../lib/auth';

export function MfaVerifyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setTokens } = useAuth();
  const mfaChallengeToken = (location.state as { mfaChallengeToken?: string })?.mfaChallengeToken;

  const [code, setCode] = useState('');
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
      const res = await api.post<{ accessToken: string; refreshToken: string }>('/mfa/verify', {
        mfaChallengeToken,
        code,
      });
      setTokens(res.accessToken, res.refreshToken);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof ApiException ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-600">Enter the 6-digit code from your authenticator.</p>
          <FormField
            label="Code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            Verify
          </Button>
        </form>
      </Card>
    </div>
  );
}
