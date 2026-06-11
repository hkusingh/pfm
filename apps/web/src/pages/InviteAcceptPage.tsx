import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button, Card, CardHeader, CardTitle } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { AuthLayout } from '../components/AuthLayout';
import { useAuth } from '../lib/auth';

type InviteDetails = {
  id: string;
  householdId: string;
  householdName: string;
  email: string;
  role: 'owner' | 'member';
  expiresAt: string;
};

export function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState('');

  useEffect(() => {
    if (!token) return;
    api
      .get<InviteDetails>(`/invites/${token}`)
      .then(setInvite)
      .catch((err) => {
        setLoadError(
          err instanceof ApiException ? err.message : 'Invite not found or has expired.',
        );
      })
      .finally(() => setLoading(false));
  }, [token]);

  async function handleAccept() {
    if (!token) return;
    setAcceptError('');
    setAccepting(true);
    try {
      await api.post(`/invites/${token}/accept`, {});
      navigate('/dashboard');
    } catch (err) {
      setAcceptError(err instanceof ApiException ? err.message : 'Failed to accept invite.');
    } finally {
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <AuthLayout>
        <Card>
          <CardHeader>
            <CardTitle>Loading invitation…</CardTitle>
          </CardHeader>
        </Card>
      </AuthLayout>
    );
  }

  if (loadError || !invite) {
    return (
      <AuthLayout>
        <Card>
          <CardHeader>
            <CardTitle>Invitation not found</CardTitle>
          </CardHeader>
          <div className="px-6 pb-6 space-y-4">
            <p className="text-sm text-gray-600">
              {loadError || 'This invite link is invalid or has expired.'}
            </p>
            <Button variant="secondary" className="w-full" onClick={() => navigate('/login')}>
              Back to sign in
            </Button>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  const roleLabel = invite.role === 'owner' ? 'co-owner' : 'member';

  // If the user is not logged in, send them to sign up / log in first
  if (!isAuthenticated) {
    return (
      <AuthLayout>
        <Card>
          <CardHeader>
            <CardTitle>You've been invited</CardTitle>
          </CardHeader>
          <div className="px-6 pb-6 space-y-4">
            <p className="text-sm text-gray-600">
              You've been invited to join <strong>{invite.householdName}</strong> as a {roleLabel}.
            </p>
            <p className="text-sm text-gray-600">
              Create an account or sign in to accept this invitation.
            </p>
            <Button
              className="w-full"
              onClick={() => navigate(`/signup?householdInvite=${token}`)}
            >
              Create account
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => navigate(`/login?householdInvite=${token}`)}
            >
              Sign in
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
          <CardTitle>Join {invite.householdName}</CardTitle>
        </CardHeader>
        <div className="px-6 pb-6 space-y-4">
          <p className="text-sm text-gray-600">
            You've been invited to join <strong>{invite.householdName}</strong> as a {roleLabel}.
          </p>
          <p className="text-xs text-gray-500">
            Invite sent to: {invite.email}
          </p>
          {acceptError && <p className="text-sm text-red-600">{acceptError}</p>}
          <Button className="w-full" loading={accepting} onClick={handleAccept}>
            Accept invitation
          </Button>
          <p className="text-center text-sm text-gray-500">
            <Link to="/dashboard" className="hover:underline">
              Decline
            </Link>
          </p>
        </div>
      </Card>
    </AuthLayout>
  );
}
