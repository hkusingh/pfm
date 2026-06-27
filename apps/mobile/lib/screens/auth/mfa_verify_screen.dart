import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api.dart';
import '../../core/auth.dart';
import '../../core/theme.dart';

class MfaVerifyScreen extends ConsumerStatefulWidget {
  final String mfaToken;
  const MfaVerifyScreen({super.key, required this.mfaToken});
  @override
  ConsumerState<MfaVerifyScreen> createState() => _State();
}

class _State extends ConsumerState<MfaVerifyScreen> {
  final _otp = TextEditingController();
  bool _loading = false;
  String? _error;

  Future<void> _verify() async {
    if (_otp.text.length < 6) { setState(() => _error = 'Enter 6-digit code'); return; }
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiProvider);
      final resp = await api.post<Map<String, dynamic>>(
        '/mfa/verify', (d) => d as Map<String, dynamic>,
        body: {'code': _otp.text, 'mfaChallengeToken': widget.mfaToken},
      );
      final access = resp['accessToken'] as String?;
      final refresh = resp['refreshToken'] as String?;
      if (access == null || refresh == null) throw Exception('Unexpected MFA response');
      await ref.read(authProvider).setTokens(access, refresh);
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  void dispose() { _otp.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const SizedBox(height: 60),
          const Icon(Icons.shield_outlined, size: 56, color: AppColors.primary),
          const SizedBox(height: 24),
          Text('Two-factor verification', style: Theme.of(context).textTheme.headlineMedium, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          const Text('Enter the 6-digit code from your authenticator app.', style: TextStyle(color: AppColors.textSecondary, fontSize: 14), textAlign: TextAlign.center),
          const SizedBox(height: 40),
          TextField(
            controller: _otp,
            keyboardType: TextInputType.number,
            maxLength: 6,
            autofocus: true,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 28, letterSpacing: 10, fontWeight: FontWeight.w600),
            decoration: const InputDecoration(hintText: '• • • • • •', counterText: ''),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13), textAlign: TextAlign.center),
          ],
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _loading ? null : _verify,
            child: _loading ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Text('Verify'),
          ),
        ]),
      )),
    );
  }
}
