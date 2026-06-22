import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../widgets/budget_bar.dart';

class BudgetsScreen extends ConsumerStatefulWidget {
  const BudgetsScreen({super.key});
  @override
  ConsumerState<BudgetsScreen> createState() => _State();
}

class _State extends ConsumerState<BudgetsScreen> {
  String? _hid;
  String _currency = 'USD';
  List<BudgetItem> _expenseGroups = [];
  List<IncomeSummaryItem> _incomeItems = [];
  int _sinkingTotal = 0;
  bool _loading = true;
  String? _error;
  late String _period;
  final Set<String> _expanded = {};

  @override
  void initState() { super.initState(); _period = currentPeriod(); _load(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiProvider);
      final hh = await api.get('/households/me', (d) => Household.fromJson(d as Map<String, dynamic>));
      _hid = hh.id; _currency = hh.currency;

      final results = await Future.wait([
        api.get('/households/${hh.id}/budgets',
          (d) => (d['items'] as List).map((e) => BudgetItem.fromJson(e as Map<String, dynamic>)).toList(),
          params: {'period': _period}),
        api.get('/households/${hh.id}/income-summary',
          (d) => (d['items'] as List).map((e) => IncomeSummaryItem.fromJson(e as Map<String, dynamic>)).toList(),
          params: {'period': _period}),
        api.get('/households/${hh.id}/sinking-funds',
          (d) => (d as List).map((e) => (e as Map<String, dynamic>)['reserveBalanceMinor'] as int? ?? 0).fold(0, (a, b) => a + b),
          params: {}),
      ]);

      setState(() {
        _expenseGroups = (results[0] as List<BudgetItem>)
          .where((i) => i.parentId == null && i.kind == 'expense').toList()
          ..sort((a, b) => b.budgetMinor.compareTo(a.budgetMinor));
        _incomeItems = results[1] as List<IncomeSummaryItem>;
        _sinkingTotal = results[2] as int;
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  void _shift(int delta) { setState(() { _period = shiftPeriod(_period, delta); }); _load(); }

  Color _barColor(double ratio) {
    if (ratio > 1.0) return AppColors.danger;
    if (ratio >= 0.8) return AppColors.warning;
    return AppColors.accent;
  }

  @override
  Widget build(BuildContext context) {
    final incomeReceived = _incomeItems.fold(0, (s, i) => s + i.receivedMinor);
    final incomeExpected = _incomeItems.fold(0, (s, i) => s + i.expectedMinor);

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
              // Header
              SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 4),
                child: Row(children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Budgets', style: Theme.of(context).textTheme.titleLarge),
                    Text(periodLabel(_period), style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                  ])),
                  IconButton(icon: const Icon(Icons.chevron_left), onPressed: () => _shift(-1)),
                  IconButton(icon: const Icon(Icons.chevron_right), onPressed: () => _shift(1)),
                ]),
              )),

              // Income row
              SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                child: _CategoryRow(
                  label: 'Income',
                  left: fmtMinor(incomeReceived, currency: _currency),
                  right: fmtMinor(incomeExpected, currency: _currency),
                  progress: incomeExpected > 0 ? incomeReceived / incomeExpected : 0,
                  barColor: AppColors.success,
                  isExpanded: _expanded.contains('__income__'),
                  onTap: () => setState(() {
                    if (_expanded.contains('__income__')) _expanded.remove('__income__');
                    else _expanded.add('__income__');
                  }),
                  children: _incomeItems.map((item) => Padding(
                    padding: const EdgeInsets.only(left: 16, top: 8),
                    child: _CategoryRow(
                      label: item.categoryName,
                      left: fmtMinor(item.receivedMinor, currency: _currency),
                      right: fmtMinor(item.expectedMinor, currency: _currency),
                      progress: item.expectedMinor > 0 ? item.receivedMinor / item.expectedMinor : 0,
                      barColor: AppColors.success,
                      small: true,
                    ),
                  )).toList(),
                ),
              )),

              // Expense groups
              SliverList(delegate: SliverChildBuilderDelegate((ctx, i) {
                final item = _expenseGroups[i];
                final ratio = item.spentRatio;
                return Padding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                  child: _CategoryRow(
                    label: item.categoryName,
                    left: fmtMinor(item.spentMinor, currency: _currency),
                    right: fmtMinor(item.budgetMinor, currency: _currency),
                    progress: ratio,
                    barColor: _barColor(ratio),
                    isExpanded: _expanded.contains(item.categoryId),
                    onTap: item.children.isNotEmpty ? () => setState(() {
                      if (_expanded.contains(item.categoryId)) _expanded.remove(item.categoryId);
                      else _expanded.add(item.categoryId);
                    }) : null,
                    children: item.children.map((child) => Padding(
                      padding: const EdgeInsets.only(left: 16, top: 8),
                      child: _CategoryRow(
                        label: child.categoryName,
                        left: fmtMinor(child.spentMinor, currency: _currency),
                        right: fmtMinor(child.budgetMinor, currency: _currency),
                        progress: child.spentRatio,
                        barColor: _barColor(child.spentRatio),
                        small: true,
                      ),
                    )).toList(),
                  ),
                );
              }, childCount: _expenseGroups.length)),

              // Sinking funds banner
              if (_sinkingTotal > 0) SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.success.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.success.withOpacity(0.3)),
                  ),
                  child: Row(children: [
                    const Icon(Icons.savings_outlined, color: AppColors.success, size: 20),
                    const SizedBox(width: 10),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('Sinking funds — ${fmtMinor(_sinkingTotal, currency: _currency)} reserved',
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: AppColors.success)),
                    ])),
                  ]),
                ),
              )),

              const SliverToBoxAdapter(child: SizedBox(height: 16)),
            ])),
      ),
    );
  }
}

class _CategoryRow extends StatelessWidget {
  final String label;
  final String left;
  final String right;
  final double progress;
  final Color barColor;
  final bool isExpanded;
  final VoidCallback? onTap;
  final List<Widget> children;
  final bool small;

  const _CategoryRow({
    required this.label, required this.left, required this.right,
    required this.progress, required this.barColor,
    this.isExpanded = false, this.onTap, this.children = const [], this.small = false,
  });

  @override
  Widget build(BuildContext context) {
    return Card(child: Padding(
      padding: EdgeInsets.all(small ? 10 : 14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        GestureDetector(
          onTap: onTap,
          child: Row(children: [
            if (children.isNotEmpty) ...[
              AnimatedRotation(turns: isExpanded ? 0 : -0.25, duration: const Duration(milliseconds: 150),
                child: const Icon(Icons.expand_more, size: 18, color: AppColors.textSecondary)),
              const SizedBox(width: 6),
            ],
            Expanded(child: Text(label, style: TextStyle(fontWeight: FontWeight.w600, fontSize: small ? 13 : 14))),
            Text('$left / $right', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          ]),
        ),
        const SizedBox(height: 8),
        BudgetBar(progress: progress, height: small ? 6 : 8),
        if (isExpanded && children.isNotEmpty) ...children,
      ]),
    ));
  }
}
