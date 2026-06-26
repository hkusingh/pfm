import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api.dart';
import '../../core/auth.dart';
import '../../core/theme.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _State();
}

class _State extends ConsumerState<LoginScreen> {
  final _email    = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  String? _error;
  bool _obscure = true;

  @override
  void dispose() { _email.dispose(); _password.dispose(); super.dispose(); }

  Future<void> _login() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiProvider);
      final resp = await api.post<Map<String, dynamic>>(
        '/auth/login', (d) => d as Map<String, dynamic>,
        body: {'email': _email.text.trim(), 'password': _password.text},
      );
      if (resp['status'] == 'mfa_required') {
        if (mounted) context.go('/mfa-verify?mfaToken=${resp['mfaChallengeToken'] ?? ''}');
      } else {
        final access = resp['accessToken'] as String?;
        final refresh = resp['refreshToken'] as String?;
        if (access == null || refresh == null) throw Exception('Unexpected login response');
        await ref.read(authProvider).setTokens(access, refresh);
      }
    } catch (e) {
      setState(() { _error = e.toString(); });
    } finally {
      if (mounted) setState(() { _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const SizedBox(height: 48),
          // Logo
          Center(child: Row(mainAxisSize: MainAxisSize.min, children: [
            Container(
              width: 40, height: 40,
              decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(12)),
              child: const Center(child: Text('P', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 20))),
            ),
            const SizedBox(width: 10),
            const Text('PFM', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.primary)),
          ])),
          const SizedBox(height: 40),
          Text('Welcome back', style: Theme.of(context).textTheme.headlineMedium, textAlign: TextAlign.center),
          const SizedBox(height: 6),
          const Text('Sign in to your household account', style: TextStyle(color: AppColors.textSecondary, fontSize: 14), textAlign: TextAlign.center),
          const SizedBox(height: 32),
          TextField(controller: _email, decoration: const InputDecoration(hintText: 'Email'), keyboardType: TextInputType.emailAddress, autocorrect: false, textCapitalization: TextCapitalization.none),
          const SizedBox(height: 12),
          TextField(
            controller: _password, obscureText: _obscure,
            decoration: InputDecoration(
              hintText: 'Password',
              suffixIcon: IconButton(icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility, color: AppColors.textSecondary), onPressed: () => setState(() => _obscure = !_obscure)),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13), textAlign: TextAlign.center),
          ],
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: _loading ? null : _login,
            child: _loading ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Text('Sign in'),
          ),
          const SizedBox(height: 20),
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Text('New user? ', style: TextStyle(color: AppColors.textSecondary)),
            GestureDetector(onTap: () => context.go('/signup'), child: const Text('Create household', style: TextStyle(color: AppColors.accent, fontWeight: FontWeight.w600))),
          ]),
        ]),
      )),
    );
  }
}
