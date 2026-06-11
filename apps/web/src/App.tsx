import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { MfaSetupPage } from './pages/MfaSetupPage';
import { MfaVerifyPage } from './pages/MfaVerifyPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { CreateHouseholdPage } from './pages/CreateHouseholdPage';
import { HouseholdSettingsPage } from './pages/HouseholdSettingsPage';
import { AccountsPage } from './pages/AccountsPage';
import { InviteAcceptPage } from './pages/InviteAcceptPage';
import { AdminLayout } from './components/AdminLayout';
import { InvitesPage } from './pages/admin/InvitesPage';
import { UsersPage } from './pages/admin/UsersPage';
import { PolicyPage } from './pages/admin/PolicyPage';

function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}

function PublicOnlyRoute() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public-only routes: redirect to dashboard if already authed */}
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
          </Route>

          {/* Open routes (MFA flow, email verify, password reset) */}
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/mfa/setup" element={<MfaSetupPage />} />
          <Route path="/mfa/verify" element={<MfaVerifyPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Household invite — accessible logged in or out */}
          <Route path="/invites/:token" element={<InviteAcceptPage />} />

          {/* Protected */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/onboarding/household" element={<CreateHouseholdPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/settings/household" element={<HouseholdSettingsPage />} />
            {/* Admin section — AdminLayout enforces isSiteAdmin */}
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="/admin/invites" replace />} />
              <Route path="invites" element={<InvitesPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="policy" element={<PolicyPage />} />
            </Route>
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
