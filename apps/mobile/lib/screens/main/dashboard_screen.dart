import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../widgets/donut_chart.dart';
import '../../widgets/budget_bar.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});
  @override
  ConsumerState<DashboardScreen> createState() => _State();
}

class _State extends ConsumerState<DashboardScreen> {
  User? _user;
  Household? _household;
  DashboardSummary? _summary;
  List<SpendingCategory> _spendingByCategory = [];
  List<BudgetItem> _budgetItems = [];
  bool _loading = true;
  String? _error;
  String _view = 'household';
  late String _period;

  @override
  void initState() {
    super.initState();
    _period = currentPeriod();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiProvider);
      _user = await api.get('/auth/me', (d) => User.fromJson(d as Map<String, dynamic>));
      _household = await api.get('/households/me', (d) => Household.fromJson(d as Map<String, dynamic>));
      final hid = _household!.id;

      final results = await Future.wait([
        api.get('/households/$hid/dashboard/summary',
          (d) => DashboardSummary.fromJson(d as Map<String, dynamic>),
          params: {'period': _period, 'view': _view}),
        api.get('/households/$hid/spending-by-category',
          (d) => (d['items'] as List).map((e) => SpendingCategory.fromJson(e as Map<String, dynamic>)).toList(),
          params: {'period': _period, 'view': _view}),
        api.get('/households/$hid/budgets',
          (d) => (d['items'] as List).map((e) => BudgetItem.fromJson(e as Map<String, dynamic>)).toList(),
          params: {'period': _period}),
      ]);

      setState(() {
        _summary = results[0] as DashboardSummary;
        _spendingByCategory = results[1] as List<SpendingCategory>;
        _budgetItems = (results[2] as List<BudgetItem>).where((i) => i.parentId == null && i.kind == 'expense' && (i.budgetMinor > 0 || i.spentMinor > 0)).toList()
          ..sort((a, b) => b.spentMinor.compareTo(a.spentMinor));
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Color _hexColor(String hex) {
    try { return Color(int.parse(hex.replaceFirst('#', '0xFF'))); } catch (_) { return AppColors.textSecondary; }
  }

  @override
  Widget build(BuildContext context) {
    final currency = _household?.currency ?? 'USD';
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(child: _loading
        ? const Center(child: CircularProgressIndicator())
        : _error != null
          ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(_error!, style: const TextStyle(color: AppColors.danger), textAlign: TextAlign.center),
              const SizedBox(height: 12),
              TextButton(onPressed: _load, child: const Text('Retry')),
            ]))
          : RefreshIndicator(onRefresh: _load, child: CustomScrollView(slivers: [
              // App bar with greeting
              SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                child: Row(children: [
                  Expanded(child: Text('${greeting()},\n${_user?.name ?? _user?.email ?? ''}',
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.textPrimary, height: 1.25))),
                  CircleAvatar(backgroundColor: AppColors.primary, radius: 20,
                    child: Text(_user?.initials ?? '?', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700))),
                ]),
              )),

              // Household / Personal toggle
              SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                child: Container(
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: AppColors.border)),
                  padding: const EdgeInsets.all(3),
                  child: Row(children: ['household', 'personal'].map((v) => Expanded(
                    child: GestureDetector(
                      onTap: () { setState(() => _view = v); _load(); },
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        padding: const EdgeInsets.symmetric(vertical: 7),
                        decoration: BoxDecoration(
                          color: _view == v ? AppColors.primary : Colors.transparent,
                          borderRadius: BorderRadius.circular(7),
                        ),
                        child: Text(v[0].toUpperCase() + v.substring(1),
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600,
                            color: _view == v ? Colors.white : AppColors.textSecondary)),
                      ),
                    ),
                  )).toList(),
                ),
              )),

              // KPI cards
              if (_summary != null) SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                child: Row(children: [
                  Expanded(child: _kpiCard('SPENDING', fmtMinor(_summary!.spendingMinor, currency: currency),
                    sub: '${_summary!.spendingVsLastMonth >= 0 ? '▲' : '▼'} ${_summary!.spendingVsLastMonth.abs().toStringAsFixed(0)}% vs last month',
                    subColor: _summary!.spendingVsLastMonth > 0 ? AppColors.danger : AppColors.success)),
                  const SizedBox(width: 12),
                  Expanded(child: _kpiCard('BUDGET LEFT', fmtMinor(_summary!.budgetRemainingMinor, currency: currency),
                    sub: 'of ${fmtMinor(_summary!.budgetMinor, currency: currency)}',
                    subColor: AppColors.textSecondary)),
                ]),
              )),

              // Spending by category
              SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                child: Card(child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('Spending by category', style: Theme.of(context).textTheme.titleMedium)),
                      Text(periodLabel(_period), style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                    ]),
                    const SizedBox(height: 16),
                    if (_spendingByCategory.isEmpty)
                      const Center(child: Text('No spending data', style: TextStyle(color: AppColors.textSecondary)))
                    else
                      Center(child: DonutChart(
                        segments: _spendingByCategory.take(5).map((s) => DonutSegment(
                          label: s.categoryName,
                          value: s.amountMinor.toDouble(),
                          color: _hexColor(s.color),
                        )).toList(),
                      )),
                  ]),
                )),
              )),

              // Budget vs actual
              SliverToBoxAdapter(child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
                child: Card(child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Budget vs. actual', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 12),
                    if (_budgetItems.isEmpty)
                      const Text('No budgets set', style: TextStyle(color: AppColors.textSecondary))
                    else
                      ..._budgetItems.take(5).map((item) => Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(item.categoryName, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
                          const SizedBox(height: 4),
                          BudgetBar(progress: item.spentRatio),
                        ]),
                      )),
                  ]),
                )),
              )),
            ])),
      ),
    );
  }

  Widget _kpiCard(String label, String value, {required String sub, required Color subColor}) => Card(
    child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppColors.textSecondary, letterSpacing: 0.5)),
      const SizedBox(height: 4),
      Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
      const SizedBox(height: 2),
      Text(sub, style: TextStyle(fontSize: 11, color: subColor)),
    ])),
  );
}
