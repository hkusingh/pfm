import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api.dart';
import '../../core/auth.dart';
import '../../core/theme.dart';

class MfaSetupScreen extends ConsumerStatefulWidget {
  final String accessToken;
  final String householdName;
  const MfaSetupScreen({super.key, required this.accessToken, required this.householdName});
  @override
  ConsumerState<MfaSetupScreen> createState() => _State();
}

class _State extends ConsumerState<MfaSetupScreen> {
  String? _qrUrl;
  String? _secret;
  bool _loadingQr = true;
  String? _loadError;

  final _otp = TextEditingController();
  bool _verifying = false;
  String? _verifyError;
  bool _useEmail = false;

  @override
  void initState() {
    super.initState();
    _loadSetup();
  }

  Future<void> _loadSetup() async {
    try {
      final api = ref.read(apiProvider);
      final resp = await api.post<Map<String, dynamic>>(
        '/auth/mfa/setup', (d) => d as Map<String, dynamic>, body: {},
      );
      setState(() { _qrUrl = resp['qrCodeUrl'] as String?; _secret = resp['secret'] as String?; _loadingQr = false; });
    } catch (e) {
      setState(() { _loadError = e.toString(); _loadingQr = false; });
    }
  }

  Future<void> _verify() async {
    if (_otp.text.length < 6) { setState(() => _verifyError = 'Enter 6-digit code'); return; }
    setState(() { _verifying = true; _verifyError = null; });
    try {
      final api = ref.read(apiProvider);
      final resp = await api.post<Map<String, dynamic>>(
        '/auth/mfa/verify', (d) => d as Map<String, dynamic>,
        body: {'token': _otp.text},
      );
      // Create household
      await api.post<void>('/households', (_) {}, body: {'name': widget.householdName});
      if (mounted) await ref.read(authProvider).setTokens(resp['accessToken'] as String, resp['refreshToken'] as String);
    } catch (e) {
      setState(() { _verifyError = e.toString(); _verifying = false; });
    }
  }

  @override
  void dispose() { _otp.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const SizedBox(height: 24),
          Text('Secure your account', style: Theme.of(context).textTheme.headlineMedium, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          const Text('Two-factor is required for all accounts.', style: TextStyle(color: AppColors.textSecondary, fontSize: 14), textAlign: TextAlign.center),
          const SizedBox(height: 24),

          // Method toggle
          Container(
            decoration: BoxDecoration(color: AppColors.bg, borderRadius: BorderRadius.circular(10)),
            padding: const EdgeInsets.all(4),
            child: Row(children: [
              _tab('Authenticator', !_useEmail, () => setState(() => _useEmail = false)),
              _tab('Email code',    _useEmail,  () => setState(() => _useEmail = true)),
            ]),
          ),
          const SizedBox(height: 28),

          // QR code
          if (_loadingQr)
            const Center(child: CircularProgressIndicator())
          else if (_loadError != null)
            Text(_loadError!, style: const TextStyle(color: AppColors.danger), textAlign: TextAlign.center)
          else if (_qrUrl != null && !_useEmail)
            Center(child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.network(_qrUrl!, width: 200, height: 200,
                errorBuilder: (_, __, ___) => Container(
                  width: 200, height: 200,
                  decoration: BoxDecoration(color: AppColors.bg, borderRadius: BorderRadius.circular(12)),
                  child: Center(child: Text('Secret:\n$_secret', style: const TextStyle(fontFamily: 'monospace', fontSize: 12), textAlign: TextAlign.center)),
                ),
              ),
            )),
          const SizedBox(height: 16),
          const Text('Scan with Google Authenticator, then enter the 6-digit code.', style: TextStyle(color: AppColors.textSecondary, fontSize: 13), textAlign: TextAlign.center),
          const SizedBox(height: 24),

          // OTP input
          TextField(
            controller: _otp,
            keyboardType: TextInputType.number,
            maxLength: 6,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 24, letterSpacing: 8, fontWeight: FontWeight.w600),
            decoration: const InputDecoration(hintText: '• • • • • •', counterText: ''),
          ),
          if (_verifyError != null) ...[
            const SizedBox(height: 8),
            Text(_verifyError!, style: const TextStyle(color: AppColors.danger, fontSize: 13), textAlign: TextAlign.center),
          ],
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: _verifying ? null : _verify,
            child: _verifying ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Text('Verify & finish'),
          ),
          const SizedBox(height: 12),
          const Text('Recovery codes shown after setup.', style: TextStyle(color: AppColors.textSecondary, fontSize: 12), textAlign: TextAlign.center),
        ]),
      )),
    );
  }

  Widget _tab(String label, bool active, VoidCallback onTap) => Expanded(
    child: GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: active ? Colors.white : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          boxShadow: active ? [BoxShadow(color: Colors.black.withOpacity(0.08), blurRadius: 4, offset: const Offset(0, 1))] : null,
        ),
        child: Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: active ? AppColors.primary : AppColors.textSecondary), textAlign: TextAlign.center),
      ),
    ),
  );
}
