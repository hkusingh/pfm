import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Button, FormField, Card, CardHeader, CardTitle } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { AuthLayout } from '../components/AuthLayout';

export function SignupPage() {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite') ?? undefined;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ emailVerifiedAt: string | null }>('/auth/signup', { email, password, inviteToken });
      if (res.emailVerifiedAt) {
        // AUTH_GATE off — email auto-verified, go straight to login
        navigate('/login');
      } else {
        setDone(true);
      }
    } catch (err) {
      setError(err instanceof ApiException ? err.message : 'Signup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthLayout>
        <Card>
          <CardHeader>
            <CardTitle>Check your email</CardTitle>
          </CardHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              We sent a verification link to <strong>{email}</strong>. Click it to activate your
              account, then set up two-factor authentication.
            </p>
            <Button variant="secondary" className="w-full" onClick={() => navigate('/login')}>
              Back to sign in
            </Button>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>Create account</CardTitle>
        </CardHeader>
        {!inviteToken && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 mb-4">
            This is an invitation-only service. You need a valid invite link to create an account.
          </div>
        )}
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
            autoComplete="new-password"
            hint="Minimum 12 characters"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            Create account
          </Button>
        </form>
        <p className="mt-4 text-sm text-center text-gray-600">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </AuthLayout>
  );
}
