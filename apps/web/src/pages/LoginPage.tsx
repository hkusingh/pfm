import { Card, CardHeader, CardTitle } from '@pfm/ui';
import { AuthLayout } from '../components/AuthLayout';
import { LoginForm } from '../components/LoginForm';

export function LoginPage() {
  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <LoginForm />
      </Card>
    </AuthLayout>
  );
}
