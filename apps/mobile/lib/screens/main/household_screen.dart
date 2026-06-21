import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api.dart';
import '../../core/auth.dart';
import '../../core/theme.dart';
import '../../models/models.dart';

class HouseholdScreen extends ConsumerStatefulWidget {
  const HouseholdScreen({super.key});
  @override
  ConsumerState<HouseholdScreen> createState() => _State();
}

class _State extends ConsumerState<HouseholdScreen> {
  User? _user;
  Household? _household;
  List<Member> _members = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiProvider);
      _user = await api.get('/auth/me', (d) => User.fromJson(d as Map<String, dynamic>));
      _household = await api.get('/households/me', (d) => Household.fromJson(d as Map<String, dynamic>));
      _members = await api.get(
        '/households/${_household!.id}/members',
        (d) => (d as List).map((e) => Member.fromJson(e as Map<String, dynamic>)).toList(),
      );
      setState(() => _loading = false);
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _signOut() async {
    await ref.read(authProvider).clearTokens();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(child: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
          ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(_error!, style: const TextStyle(color: AppColors.danger), textAlign: TextAlign.center),
              TextButton(onPressed: _load, child: const Text('Retry')),
            ]))
          : RefreshIndicator(onRefresh: _load, child: CustomScrollView(slivers: [
              SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                child: Text('Household', style: Theme.of(context).textTheme.titleLarge),
              )),

              // Profile card
              SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                child: Card(child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(children: [
                    CircleAvatar(
                      radius: 26, backgroundColor: AppColors.primary,
                      child: Text(_user?.initials ?? '?', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 18)),
                    ),
                    const SizedBox(width: 14),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(_user?.name ?? '', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                      Text(_user?.email ?? '', style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                    ])),
                  ]),
                )),
              )),

              // Household info
              SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                child: Card(child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      const Icon(Icons.home_outlined, size: 18, color: AppColors.primary),
                      const SizedBox(width: 8),
                      Text(_household?.name ?? '', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                    ]),
                    const Divider(height: 20),
                    Text('MEMBERS', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.textSecondary, letterSpacing: 0.8)),
                    const SizedBox(height: 10),
                    ..._members.map((m) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(children: [
                        CircleAvatar(
                          radius: 16, backgroundColor: AppColors.primary.withOpacity(0.12),
                          child: Text((m.name?.isNotEmpty == true ? m.name![0] : m.email[0]).toUpperCase(),
                            style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w700, fontSize: 13)),
                        ),
                        const SizedBox(width: 10),
                        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(m.name ?? m.email, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                          if (m.name != null) Text(m.email, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                        ])),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(color: AppColors.bg, borderRadius: BorderRadius.circular(5)),
                          child: Text(m.role, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                        ),
                      ]),
                    )),
                  ]),
                )),
              )),

              // Sign out
              SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
                child: OutlinedButton.icon(
                  onPressed: _signOut,
                  icon: const Icon(Icons.logout, size: 18),
                  label: const Text('Sign out'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.danger,
                    side: const BorderSide(color: AppColors.danger),
                    minimumSize: const Size.fromHeight(46),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              )),
            ])),
      ),
    );
  }
}
