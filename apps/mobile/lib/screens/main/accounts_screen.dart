import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../core/api.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/models.dart';

class AccountsScreen extends ConsumerStatefulWidget {
  const AccountsScreen({super.key});
  @override
  ConsumerState<AccountsScreen> createState() => _State();
}

class _State extends ConsumerState<AccountsScreen> {
  String? _hid;
  List<Account> _accounts = [];
  bool _loading = true;
  String? _error;
  bool _uploading = false;
  String? _uploadMsg;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiProvider);
      final hh = await api.get('/households/me', (d) => Household.fromJson(d as Map<String, dynamic>));
      _hid = hh.id;
      final data = await api.get(
        '/households/${hh.id}/accounts',
        (d) {
          final map = d as Map<String, dynamic>;
          final own = (map['own'] as List).map((e) => Account.fromJson(e as Map<String, dynamic>)).toList();
          final shared = (map['shared'] as List).map((e) => Account.fromJson(e as Map<String, dynamic>)).toList();
          return [...own, ...shared];
        },
      );
      setState(() { _accounts = data; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _upload() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom, allowedExtensions: ['csv', 'ofx', 'qfx'],
    );
    if (result == null || result.files.single.path == null) return;

    setState(() { _uploading = true; _uploadMsg = null; });
    try {
      final file = File(result.files.single.path!);
      final token = await const FlutterSecureStorage().read(key: 'accessToken');
      // Accounts page — user picks account first (simplified: use first own account)
      final ownAccount = _accounts.firstWhere((a) => a.isOwner, orElse: () => _accounts.first);
      final dio = Dio(BaseOptions(baseUrl: apiUrl));
      if (token != null) dio.options.headers['Authorization'] = 'Bearer $token';
      await dio.post(
        '/households/$_hid/accounts/${ownAccount.id}/import/upload',
        data: FormData.fromMap({'file': await MultipartFile.fromFile(file.path, filename: result.files.single.name)}),
      );
      setState(() { _uploadMsg = 'Statement uploaded — import in progress.'; _uploading = false; });
      await _load();
    } catch (e) {
      setState(() { _uploadMsg = 'Upload failed: $e'; _uploading = false; });
    }
  }

  String _maskedNumber(String? lastFour) => lastFour != null ? '··$lastFour' : '··';

  @override
  Widget build(BuildContext context) {
    final myAccounts    = _accounts.where((a) => a.isOwner).toList();
    final sharedAccounts = _accounts.where((a) => !a.isOwner).toList();

    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        title: const Text('Accounts'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/dashboard'),
        ),
        actions: [
          if (_uploading)
            TextButton(
              onPressed: () => setState(() { _uploading = false; _uploadMsg = null; }),
              child: const Text('Cancel', style: TextStyle(color: AppColors.danger)),
            ),
        ],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
          ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(_error!, style: const TextStyle(color: AppColors.danger), textAlign: TextAlign.center),
              TextButton(onPressed: _load, child: const Text('Retry')),
            ]))
          : RefreshIndicator(onRefresh: _load, child: CustomScrollView(slivers: [
              // Upload statement button
              SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                child: GestureDetector(
                  onTap: _uploading ? null : _upload,
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
                    decoration: BoxDecoration(
                      border: Border.all(color: AppColors.border, width: 1.5),
                      borderRadius: BorderRadius.circular(12),
                      color: Colors.white,
                    ),
                    child: Column(children: [
                      _uploading
                        ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.upload_outlined, color: AppColors.primary, size: 26),
                      const SizedBox(height: 6),
                      const Text('Upload a statement', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: AppColors.primary)),
                      const Text('CSV / OFX / QFX · no login stored', style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                    ]),
                  ),
                ),
              )),

              if (_uploadMsg != null) SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                child: Text(_uploadMsg!, style: TextStyle(fontSize: 12, color: _uploadMsg!.startsWith('Upload failed') ? AppColors.danger : AppColors.success), textAlign: TextAlign.center),
              )),

              // Your accounts
              if (myAccounts.isNotEmpty) ...[
                SliverToBoxAdapter(child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
                  child: Text('YOUR ACCOUNTS', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.textSecondary, letterSpacing: 0.8)),
                )),
                SliverList(delegate: SliverChildBuilderDelegate((ctx, i) {
                  return Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 8), child: _AccountTile(_accounts[i]));
                }, childCount: myAccounts.length)),
              ],

              // Shared with you
              if (sharedAccounts.isNotEmpty) ...[
                SliverToBoxAdapter(child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
                  child: Text('SHARED WITH YOU', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.textSecondary, letterSpacing: 0.8)),
                )),
                SliverList(delegate: SliverChildBuilderDelegate((ctx, i) {
                  return Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 8), child: _AccountTile(sharedAccounts[i]));
                }, childCount: sharedAccounts.length)),
              ],

              const SliverToBoxAdapter(child: SizedBox(height: 16)),
            ])),
    );
  }
}

class _AccountTile extends StatelessWidget {
  final Account account;
  const _AccountTile(this.account);

  String _maskedNumber(String? lastFour) => lastFour != null ? '··${lastFour}' : '··';

  @override
  Widget build(BuildContext context) {
    final isLiability = account.isLiability;
    final balance = account.balanceMinor * (isLiability ? -1 : 1);
    return Card(child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(children: [
        Container(
          width: 36, height: 36,
          decoration: BoxDecoration(color: AppColors.bg, borderRadius: BorderRadius.circular(8)),
          child: const Icon(Icons.account_balance_outlined, size: 18, color: AppColors.primary),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(account.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
          Row(children: [
            if (account.ownerName != null && !account.isOwner) ...[
              Text('by ${account.ownerName}', style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
              const SizedBox(width: 6),
            ],
            Text('${_maskedNumber(account.lastFour)} · ${fmtMinor(balance, currency: account.currency)}',
              style: TextStyle(fontSize: 12, color: isLiability ? AppColors.danger : AppColors.textSecondary)),
          ]),
        ])),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: account.visibility == 'household' ? AppColors.accent.withOpacity(0.1) : AppColors.textSecondary.withOpacity(0.1),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            account.visibility == 'household' ? 'Shared' : 'Private',
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600,
              color: account.visibility == 'household' ? AppColors.accent : AppColors.textSecondary),
          ),
        ),
      ]),
    ));
  }
}
