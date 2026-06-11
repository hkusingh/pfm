import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, FormField, Card, CardHeader, CardTitle } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { AuthLayout } from '../components/AuthLayout';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <AuthLayout>
        <Card>
          <CardHeader><CardTitle>Invalid link</CardTitle></CardHeader>
          <div className="space-y-4">
            <p className="text-sm text-red-600">This password reset link is missing a token.</p>
            <Button variant="secondary" className="w-full" onClick={() => navigate('/forgot-password')}>
              Request a new link
            </Button>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiException ? err.message : 'Reset failed. The link may have expired.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthLayout>
        <Card>
          <CardHeader><CardTitle>Password updated</CardTitle></CardHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Your password has been reset. Sign in with your new password.</p>
            <Button className="w-full" onClick={() => navigate('/login')}>Sign in</Button>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader><CardTitle>Reset password</CardTitle></CardHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            label="New password" name="password" type="password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            required autoComplete="new-password" hint="Minimum 12 characters"
          />
          <FormField
            label="Confirm new password" name="confirm" type="password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            required autoComplete="new-password"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>Reset password</Button>
        </form>
      </Card>
    </AuthLayout>
  );
}
