import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button, FormField } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { useAuth } from '../lib/auth';

interface LoginFormProps {
  onSuccess?: () => void;  // called after successful login (e.g. close modal)
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setTokens } = useAuth();

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
        navigate('/mfa/verify', { state: { mfaChallengeToken: res.mfaChallengeToken } });
      } else if (res.mfaVerified) {
        setTokens(res.accessToken, res.refreshToken);
        onSuccess?.();
        navigate('/dashboard');
      } else {
        setTokens(res.accessToken, res.refreshToken);
        navigate('/mfa/setup');
      }
    } catch (err) {
      setError(err instanceof ApiException ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
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
      <div className="flex justify-between text-sm text-gray-500">
        <Link to="/forgot-password" className="hover:text-gray-700 hover:underline">
          Forgot password?
        </Link>
      </div>
    </form>
  );
}
