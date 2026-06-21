import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/models.dart';

class ActivityScreen extends ConsumerStatefulWidget {
  const ActivityScreen({super.key});
  @override
  ConsumerState<ActivityScreen> createState() => _State();
}

class _State extends ConsumerState<ActivityScreen> {
  List<Transaction> _txns = [];
  List<Transaction> _filtered = [];
  String? _hid;
  bool _loading = true;
  String? _error;
  final _search = TextEditingController();

  @override
  void initState() { super.initState(); _load(); _search.addListener(_filter); }
  @override
  void dispose() { _search.dispose(); super.dispose(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiProvider);
      final hh = await api.get('/households/me', (d) => Household.fromJson(d as Map<String, dynamic>));
      _hid = hh.id;
      final data = await api.get(
        '/households/${hh.id}/transactions',
        (d) => (d['items'] as List).map((e) => Transaction.fromJson(e as Map<String, dynamic>)).toList(),
        params: {'limit': '50', 'sort': 'desc'},
      );
      setState(() { _txns = data; _filtered = data; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  void _filter() {
    final q = _search.text.toLowerCase();
    setState(() {
      _filtered = q.isEmpty ? _txns : _txns.where((t) =>
        t.merchantName.toLowerCase().contains(q) ||
        (t.categoryName?.toLowerCase().contains(q) ?? false)).toList();
    });
  }

  Color _hexColor(String? hex) {
    if (hex == null) return AppColors.textSecondary;
    try { return Color(int.parse(hex.replaceFirst('#', '0xFF'))); } catch (_) { return AppColors.textSecondary; }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Activity', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            TextField(
              controller: _search,
              decoration: const InputDecoration(
                hintText: 'Search transactions',
                prefixIcon: Icon(Icons.search, color: AppColors.textSecondary, size: 20),
                contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              ),
            ),
          ]),
        ),
        Expanded(child: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
            ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                Text(_error!, style: const TextStyle(color: AppColors.danger), textAlign: TextAlign.center),
                TextButton(onPressed: _load, child: const Text('Retry')),
              ]))
            : RefreshIndicator(
                onRefresh: _load,
                child: _filtered.isEmpty
                  ? const Center(child: Text('No transactions found', style: TextStyle(color: AppColors.textSecondary)))
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                      itemCount: _filtered.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 1),
                      itemBuilder: (ctx, i) {
                        final t = _filtered[i];
                        final color = _hexColor(t.categoryColor);
                        final isIncome = t.amountMinor > 0;
                        return Container(
                          color: Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          child: Row(children: [
                            // Category icon
                            Container(
                              width: 38, height: 38,
                              decoration: BoxDecoration(
                                color: color.withOpacity(0.15),
                                shape: BoxShape.circle,
                                border: Border.all(color: color.withOpacity(0.4)),
                              ),
                              child: Center(child: Text(
                                (t.categoryName ?? t.merchantName)[0].toUpperCase(),
                                style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 14),
                              )),
                            ),
                            const SizedBox(width: 12),
                            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(t.merchantName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                              const SizedBox(height: 2),
                              Row(children: [
                                Text(t.categoryName ?? 'Uncategorized', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                                if (t.isSinkingFund) ...[
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                                    decoration: BoxDecoration(color: AppColors.warning.withOpacity(0.12), borderRadius: BorderRadius.circular(4)),
                                    child: const Text('reserve', style: TextStyle(fontSize: 10, color: AppColors.warning, fontWeight: FontWeight.w600)),
                                  ),
                                ],
                              ]),
                            ])),
                            Text(
                              '${isIncome ? '+' : ''}${fmtMinor(t.amountMinor, currency: t.currency)}',
                              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: isIncome ? AppColors.success : AppColors.textPrimary),
                            ),
                          ]),
                        );
                      },
                    ),
              ),
        ),
      ])),
    );
  }
}
