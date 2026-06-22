import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme.dart';

class ShellScreen extends StatelessWidget {
  final Widget child;
  final String location;
  const ShellScreen({super.key, required this.child, required this.location});

  static const _tabs = [
    (label: 'Home',      icon: Icons.grid_view_rounded,   path: '/dashboard'),
    (label: 'Budgets',   icon: Icons.account_balance_wallet_outlined, path: '/budgets'),
    (label: 'Activity',  icon: Icons.receipt_long_outlined, path: '/activity'),
    (label: 'Accounts',  icon: Icons.business_outlined,   path: '/accounts'),
    (label: 'Household', icon: Icons.people_outline,      path: '/household'),
  ];

  int get _currentIndex {
    for (var i = 0; i < _tabs.length; i++) {
      if (location.startsWith(_tabs[i].path)) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (i) => context.go(_tabs[i].path),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        height: 64,
        destinations: _tabs.map((t) => NavigationDestination(
          icon: Icon(t.icon),
          label: t.label,
        )).toList(),
      ),
    );
  }
}
