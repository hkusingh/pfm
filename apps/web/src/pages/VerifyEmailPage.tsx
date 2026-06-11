import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, Button } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { AuthLayout } from '../components/AuthLayout';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setStatus('error'); setMessage('Missing verification token.'); return; }
    api.post('/auth/verify-email', { token })
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error');
        setMessage(err instanceof ApiException ? err.message : 'Verification failed.');
      });
  }, [params]);

  return (
    <AuthLayout>
      <Card>
        <CardHeader><CardTitle>Email verification</CardTitle></CardHeader>
        <div className="space-y-4">
          {status === 'loading' && <p className="text-sm text-gray-600">Verifying…</p>}
          {status === 'success' && (
            <>
              <p className="text-sm text-gray-600">
                Your email is verified. Sign in to set up two-factor authentication.
              </p>
              <Button className="w-full" onClick={() => navigate('/login')}>Sign in</Button>
            </>
          )}
          {status === 'error' && (
            <>
              <p className="text-sm text-red-600">{message}</p>
              <Button variant="secondary" className="w-full" onClick={() => navigate('/login')}>
                Back to sign in
              </Button>
            </>
          )}
        </div>
      </Card>
    </AuthLayout>
  );
}
