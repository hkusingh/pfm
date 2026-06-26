class User {
  final String id;
  final String email;
  final String? name;
  final bool isSiteAdmin;
  User({required this.id, required this.email, this.name, required this.isSiteAdmin});
  factory User.fromJson(Map<String, dynamic> j) => User(
    id: j['id'] as String, email: j['email'] as String,
    name: j['name'] as String?, isSiteAdmin: j['isSiteAdmin'] as bool? ?? false,
  );
  String get initials => (name?.isNotEmpty == true ? name![0] : email[0]).toUpperCase();
}

class Household {
  final String id;
  final String name;
  final String currency;
  Household({required this.id, required this.name, required this.currency});
  factory Household.fromJson(Map<String, dynamic> j) => Household(
    id: j['id'] as String, name: j['name'] as String,
    currency: j['currency'] as String? ?? 'USD',
  );
}

class Member {
  final String id;
  final String email;
  final String? name;
  final String role;
  Member({required this.id, required this.email, this.name, required this.role});
  factory Member.fromJson(Map<String, dynamic> j) => Member(
    id: (j['userId'] ?? j['id']) as String, email: j['email'] as String,
    name: j['name'] as String?, role: j['role'] as String? ?? 'member',
  );
}

class Account {
  final String id;
  final String name;
  final String type;
  final String currency;
  final String? lastFour;
  final int balanceMinor;
  final String visibility;
  final bool isOwner;
  final String? ownerName;
  Account({required this.id, required this.name, required this.type,
    required this.currency, this.lastFour, required this.balanceMinor,
    required this.visibility, required this.isOwner, this.ownerName});
  factory Account.fromJson(Map<String, dynamic> j) => Account(
    id: j['id'] as String, name: j['name'] as String, type: j['type'] as String,
    currency: j['currency'] as String? ?? 'USD',
    lastFour: j['lastFourDigits'] as String?,
    balanceMinor: j['currentBalanceMinor'] as int? ?? 0,
    visibility: j['visibility'] as String? ?? 'household',
    isOwner: j['isOwner'] as bool? ?? true,
    ownerName: j['ownerName'] as String?,
  );
  bool get isLiability => ['credit_card', 'loan', 'mortgage'].contains(type);
}

class Transaction {
  final String id;
  final String merchantName;
  final int amountMinor;
  final String currency;
  final String postedDate;
  final String? categoryId;
  final String? categoryName;
  final String? categoryColor;
  final String accountName;
  final bool isSinkingFund;
  Transaction({required this.id, required this.merchantName, required this.amountMinor,
    required this.currency, required this.postedDate, this.categoryId,
    this.categoryName, this.categoryColor, required this.accountName, required this.isSinkingFund});
  factory Transaction.fromJson(Map<String, dynamic> j) => Transaction(
    id: j['id'] as String, merchantName: j['merchantName'] as String? ?? 'Unknown',
    amountMinor: j['amountMinor'] as int? ?? 0, currency: j['currency'] as String? ?? 'USD',
    postedDate: j['postedDate'] as String? ?? '', categoryId: j['categoryId'] as String?,
    categoryName: j['categoryName'] as String?, categoryColor: j['categoryColor'] as String?,
    accountName: j['accountName'] as String? ?? '',
    isSinkingFund: j['isSinkingFund'] as bool? ?? false,
  );
  bool get isIncome => amountMinor > 0;
}

class BudgetItem {
  final String categoryId;
  final String categoryName;
  final String? categoryColor;
  final String? parentId;
  final String kind;
  final int budgetMinor;
  final int spentMinor;
  final int sinkingFundMinor;
  final List<BudgetItem> children;
  BudgetItem({required this.categoryId, required this.categoryName,
    this.categoryColor, this.parentId, required this.kind,
    required this.budgetMinor, required this.spentMinor,
    required this.sinkingFundMinor, required this.children});
  factory BudgetItem.fromJson(Map<String, dynamic> j) => BudgetItem(
    categoryId: j['categoryId'] as String, categoryName: j['categoryName'] as String,
    categoryColor: j['categoryColor'] as String?, parentId: j['parentId'] as String?,
    kind: j['kind'] as String? ?? 'expense',
    budgetMinor: j['budgetMinor'] as int? ?? 0,
    spentMinor: j['spentMinor'] as int? ?? 0,
    sinkingFundMinor: j['sinkingFundMinor'] as int? ?? 0,
    children: (j['children'] as List<dynamic>? ?? [])
      .map((c) => BudgetItem.fromJson(c as Map<String, dynamic>)).toList(),
  );
  double get spentRatio => budgetMinor > 0 ? spentMinor / budgetMinor : 0;
}

class IncomeSummaryItem {
  final String categoryName;
  final int expectedMinor;
  final int receivedMinor;
  IncomeSummaryItem({required this.categoryName, required this.expectedMinor, required this.receivedMinor});
  factory IncomeSummaryItem.fromJson(Map<String, dynamic> j) => IncomeSummaryItem(
    categoryName: j['categoryName'] as String,
    expectedMinor: j['expectedMinor'] as int? ?? 0,
    receivedMinor: j['receivedMinor'] as int? ?? 0,
  );
}

class SpendingCategory {
  final String categoryName;
  final String color;
  final int amountMinor;
  final double pct;
  SpendingCategory({required this.categoryName, required this.color,
    required this.amountMinor, required this.pct});
  factory SpendingCategory.fromJson(Map<String, dynamic> j) => SpendingCategory(
    categoryName: j['categoryName'] as String? ?? 'Other',
    color: j['color'] as String? ?? '#6B7280',
    amountMinor: j['amountMinor'] as int? ?? 0,
    pct: ((j['pct'] as num?)?.toDouble()) ?? 0,
  );
}

class DashboardSummary {
  final int spendingMinor;
  final int budgetMinor;
  final int budgetRemainingMinor;
  final double spendingVsLastMonth;
  DashboardSummary({required this.spendingMinor, required this.budgetMinor,
    required this.budgetRemainingMinor, required this.spendingVsLastMonth});
  factory DashboardSummary.fromJson(Map<String, dynamic> j) => DashboardSummary(
    spendingMinor: j['spendingMinor'] as int? ?? 0,
    budgetMinor: j['budgetMinor'] as int? ?? 0,
    budgetRemainingMinor: j['budgetRemainingMinor'] as int? ?? 0,
    spendingVsLastMonth: ((j['spendingVsLastMonth'] as num?)?.toDouble()) ?? 0,
  );
}
