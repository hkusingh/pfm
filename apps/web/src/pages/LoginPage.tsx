import { useSearchParams } from 'react-router-dom';
import { Card, CardHeader, CardTitle } from '@pfm/ui';
import { AuthLayout } from '../components/AuthLayout';
import { LoginForm } from '../components/LoginForm';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const householdInvite = searchParams.get('householdInvite') ?? undefined;

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <LoginForm householdInvite={householdInvite} />
      </Card>
    </AuthLayout>
  );
}
