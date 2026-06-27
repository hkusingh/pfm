import 'package:intl/intl.dart';

const _symbols = {'USD': '\$', 'EUR': '€', 'GBP': '£', 'INR': '₹'};

String fmtMinor(int minor, {String currency = 'USD'}) {
  final sym = _symbols[currency] ?? '$currency ';
  final abs = minor.abs() / 100;
  final sign = minor < 0 ? '-' : '';
  final formatted = NumberFormat('#,##0', 'en_US').format(abs);
  return '$sign$sym$formatted';
}

String fmtMinorDecimal(int minor, {String currency = 'USD'}) {
  final sym = _symbols[currency] ?? '$currency ';
  final abs = minor.abs() / 100;
  final sign = minor < 0 ? '-' : '';
  final formatted = NumberFormat('#,##0.00', 'en_US').format(abs);
  return '$sign$sym$formatted';
}

String currentPeriod() {
  final now = DateTime.now().toUtc();
  return '${now.year}-${now.month.toString().padLeft(2, '0')}';
}

String periodLabel(String period) {
  final parts = period.split('-');
  final dt = DateTime(int.parse(parts[0]), int.parse(parts[1]));
  return DateFormat('MMMM yyyy').format(dt);
}

String shiftPeriod(String period, int delta) {
  final parts = period.split('-');
  final dt = DateTime(int.parse(parts[0]), int.parse(parts[1]) + delta);
  return '${dt.year}-${dt.month.toString().padLeft(2, '0')}';
}

Map<String, String> periodToRange(String period) {
  final parts = period.split('-');
  final year = int.parse(parts[0]);
  final month = int.parse(parts[1]);
  final lastDay = DateTime(year, month + 1, 0).day;
  final mm = month.toString().padLeft(2, '0');
  final dd = lastDay.toString().padLeft(2, '0');
  return {'from': '$year-$mm-01', 'to': '$year-$mm-$dd'};
}

String greeting() {
  final h = DateTime.now().hour;
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
