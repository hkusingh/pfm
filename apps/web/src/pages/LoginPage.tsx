import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Button, FormField, Card, CardHeader, CardTitle } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuthLayout } from '../components/AuthLayout';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setTokens } = useAuth();

  // Carried from household invite link — preserved through the entire auth chain
  const householdInvite = searchParams.get('householdInvite') ?? undefined;
  const postLoginDest = householdInvite ? `/invites/${householdInvite}` : '/dashboard';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const deviceToken = localStorage.getItem('deviceToken') ?? undefined;
      const res = await api.post<
        | { status: 'mfa_required'; mfaChallengeToken: string }
        | { status: 'ok'; accessToken: string; refreshToken: string; mfaVerified: boolean }
      >('/auth/login', { email, password, deviceToken });

      if (res.status === 'mfa_required') {
        navigate('/mfa/verify', { state: { mfaChallengeToken: res.mfaChallengeToken, householdInvite } });
      } else if (res.mfaVerified) {
        setTokens(res.accessToken, res.refreshToken);
        navigate(postLoginDest);
      } else {
        // No MFA enrolled yet — send to setup
        setTokens(res.accessToken, res.refreshToken);
        navigate('/mfa/setup', { state: { householdInvite } });
      }
    } catch (err) {
      setError(err instanceof ApiException ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            label="Email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <FormField
            label="Password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            Sign in
          </Button>
        </form>
        <div className="mt-4 flex justify-between text-sm text-gray-600">
          <Link to="/forgot-password" className="text-blue-600 hover:underline">
            Forgot password?
          </Link>
          <Link to="/signup" className="text-blue-600 hover:underline">
            Create account
          </Link>
        </div>
      </Card>
    </AuthLayout>
  );
}
