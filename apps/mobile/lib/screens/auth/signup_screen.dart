import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api.dart';
import '../../core/theme.dart';

class SignupScreen extends ConsumerStatefulWidget {
  const SignupScreen({super.key});
  @override
  ConsumerState<SignupScreen> createState() => _State();
}

class _State extends ConsumerState<SignupScreen> {
  final _name      = TextEditingController();
  final _email     = TextEditingController();
  final _password  = TextEditingController();
  final _household = TextEditingController();
  bool _loading = false;
  String? _error;
  bool _obscure = true;

  @override
  void dispose() { _name.dispose(); _email.dispose(); _password.dispose(); _household.dispose(); super.dispose(); }

  Future<void> _submit() async {
    if (_name.text.isEmpty || _email.text.isEmpty || _password.text.isEmpty || _household.text.isEmpty) {
      setState(() => _error = 'All fields are required.');
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiProvider);
      await api.post<void>('/auth/signup', (_) {}, body: {'name': _name.text.trim(), 'email': _email.text.trim(), 'password': _password.text});
      final loginResp = await api.post<Map<String, dynamic>>('/auth/login', (d) => d as Map<String, dynamic>,
        body: {'email': _email.text.trim(), 'password': _password.text});
      final accessToken = loginResp['accessToken'] as String? ?? '';
      if (mounted) {
        context.go('/mfa-setup?accessToken=${Uri.encodeComponent(accessToken)}&householdName=${Uri.encodeComponent(_household.text.trim())}');
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const SizedBox(height: 32),
          Center(child: Row(mainAxisSize: MainAxisSize.min, children: [
            Container(
              width: 40, height: 40,
              decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(12)),
              child: const Center(child: Text('P', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 20))),
            ),
            const SizedBox(width: 10),
            const Text('PFM', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.primary)),
          ])),
          const SizedBox(height: 32),
          Text('Create your household', style: Theme.of(context).textTheme.headlineMedium, textAlign: TextAlign.center),
          const SizedBox(height: 6),
          const Text('One shared view for everyone in your home.', style: TextStyle(color: AppColors.textSecondary, fontSize: 14), textAlign: TextAlign.center),
          const SizedBox(height: 28),
          TextField(controller: _name,      decoration: const InputDecoration(hintText: 'Your name'), textCapitalization: TextCapitalization.words),
          const SizedBox(height: 12),
          TextField(controller: _email,     decoration: const InputDecoration(hintText: 'Email'), keyboardType: TextInputType.emailAddress, autocorrect: false, textCapitalization: TextCapitalization.none),
          const SizedBox(height: 12),
          TextField(
            controller: _password, obscureText: _obscure,
            decoration: InputDecoration(
              hintText: 'Password',
              suffixIcon: IconButton(icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility, color: AppColors.textSecondary), onPressed: () => setState(() => _obscure = !_obscure)),
            ),
          ),
          const SizedBox(height: 12),
          TextField(controller: _household, decoration: const InputDecoration(hintText: 'Household name'), textCapitalization: TextCapitalization.words),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13), textAlign: TextAlign.center),
          ],
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: _loading ? null : _submit,
            child: _loading ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Text('Continue'),
          ),
          const SizedBox(height: 12),
          const Text('Next: verify email → set up MFA', style: TextStyle(color: AppColors.textSecondary, fontSize: 12), textAlign: TextAlign.center),
          const SizedBox(height: 16),
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Text('Already have an account? ', style: TextStyle(color: AppColors.textSecondary)),
            GestureDetector(onTap: () => context.go('/login'), child: const Text('Sign in', style: TextStyle(color: AppColors.accent, fontWeight: FontWeight.w600))),
          ]),
        ]),
      )),
    );
  }
}
