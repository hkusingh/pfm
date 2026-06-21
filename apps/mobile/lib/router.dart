import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'core/auth.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/signup_screen.dart';
import 'screens/auth/mfa_setup_screen.dart';
import 'screens/auth/mfa_verify_screen.dart';
import 'screens/main/shell_screen.dart';
import 'screens/main/dashboard_screen.dart';
import 'screens/main/budgets_screen.dart';
import 'screens/main/activity_screen.dart';
import 'screens/main/accounts_screen.dart';
import 'screens/main/household_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authProvider);

  return GoRouter(
    initialLocation: '/dashboard',
    refreshListenable: auth,
    redirect: (context, state) {
      if (auth.isLoading) return null;
      final authPaths = ['/login', '/signup', '/mfa-setup', '/mfa-verify'];
      final onAuth = authPaths.any((p) => state.matchedLocation.startsWith(p));
      if (!auth.isAuthenticated && !onAuth) return '/login';
      if (auth.isAuthenticated && onAuth) return '/dashboard';
      return null;
    },
    routes: [
      GoRoute(path: '/login',      builder: (c, s) => const LoginScreen()),
      GoRoute(path: '/signup',     builder: (c, s) => const SignupScreen()),
      GoRoute(path: '/mfa-setup',  builder: (c, s) => MfaSetupScreen(
        accessToken: s.uri.queryParameters['accessToken'] ?? '',
        householdName: s.uri.queryParameters['householdName'] ?? '',
      )),
      GoRoute(path: '/mfa-verify', builder: (c, s) => MfaVerifyScreen(
        mfaToken: s.uri.queryParameters['mfaToken'] ?? '',
      )),
      ShellRoute(
        builder: (context, state, child) => ShellScreen(child: child, location: state.matchedLocation),
        routes: [
          GoRoute(path: '/dashboard', builder: (c, s) => const DashboardScreen()),
          GoRoute(path: '/budgets',   builder: (c, s) => const BudgetsScreen()),
          GoRoute(path: '/activity',  builder: (c, s) => const ActivityScreen()),
          GoRoute(path: '/accounts',  builder: (c, s) => const AccountsScreen()),
          GoRoute(path: '/household', builder: (c, s) => const HouseholdScreen()),
        ],
      ),
    ],
  );
});
