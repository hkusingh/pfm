export type DefaultSubCategory = { name: string; sortOrder: number };
export type DefaultCategory = {
  name: string;
  color: string;
  kind: 'expense' | 'income' | 'transfer';
  isSystem: boolean;
  sortOrder: number;
  children: DefaultSubCategory[];
};

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    name: 'Transfer',
    color: '#718096',
    kind: 'transfer',
    isSystem: true,
    sortOrder: -1,
    children: [],
  },
  {
    name: 'Income',
    color: '#2F855A',
    kind: 'income',
    isSystem: true,
    sortOrder: 0,
    children: [
      { name: 'Salary', sortOrder: 0 },
      { name: 'Bonus', sortOrder: 1 },
      { name: 'Tax refund', sortOrder: 2 },
    ],
  },
  {
    name: 'Food',
    color: '#E53E3E',
    kind: 'expense',
    isSystem: false,
    sortOrder: 1,
    children: [
      { name: 'Groceries', sortOrder: 0 },
      { name: 'Dining out', sortOrder: 1 },
    ],
  },
  {
    name: 'Housing',
    color: '#2E6DA4',
    kind: 'expense',
    isSystem: false,
    sortOrder: 2,
    children: [
      { name: 'Rent / Mortgage', sortOrder: 0 },
      { name: 'Utilities', sortOrder: 1 },
    ],
  },
  {
    name: 'Transport',
    color: '#B9770E',
    kind: 'expense',
    isSystem: false,
    sortOrder: 3,
    children: [
      { name: 'Gas', sortOrder: 0 },
      { name: 'Public transit', sortOrder: 1 },
    ],
  },
  {
    name: 'Health',
    color: '#8e44ad',
    kind: 'expense',
    isSystem: false,
    sortOrder: 4,
    children: [
      { name: 'Medical', sortOrder: 0 },
      { name: 'Pharmacy', sortOrder: 1 },
    ],
  },
  {
    name: 'Kids',
    color: '#F6AD55',
    kind: 'expense',
    isSystem: false,
    sortOrder: 5,
    children: [],
  },
  {
    name: 'Personal',
    color: '#7c8aa0',
    kind: 'expense',
    isSystem: false,
    sortOrder: 6,
    children: [
      { name: 'Clothing', sortOrder: 0 },
      { name: 'Personal care', sortOrder: 1 },
    ],
  },
  {
    name: 'Entertainment',
    color: '#319795',
    kind: 'expense',
    isSystem: false,
    sortOrder: 7,
    children: [
      { name: 'Activities', sortOrder: 0 },
      { name: 'Subscriptions', sortOrder: 1 },
    ],
  },
  {
    name: 'Savings',
    color: '#1F8A4C',
    kind: 'expense',
    isSystem: false,
    sortOrder: 8,
    children: [],
  },
  {
    name: 'Taxes',
    color: '#744210',
    kind: 'expense',
    isSystem: false,
    sortOrder: 9,
    children: [
      { name: 'Federal income tax', sortOrder: 0 },
      { name: 'State income tax', sortOrder: 1 },
      { name: 'Property tax', sortOrder: 2 },
    ],
  },
  {
    name: 'Travel',
    color: '#0987A0',
    kind: 'expense',
    isSystem: false,
    sortOrder: 10,
    children: [
      { name: 'Flights', sortOrder: 0 },
      { name: 'Hotels & lodging', sortOrder: 1 },
      { name: 'Car rental', sortOrder: 2 },
      { name: 'Ground transport', sortOrder: 3 },
      { name: 'Travel insurance', sortOrder: 4 },
      { name: 'Food', sortOrder: 5 },
    ],
  },
  {
    name: 'Utilities',
    color: '#276749',
    kind: 'expense',
    isSystem: false,
    sortOrder: 11,
    children: [
      { name: 'Electricity', sortOrder: 0 },
      { name: 'Gas & heating', sortOrder: 1 },
      { name: 'Water', sortOrder: 2 },
      { name: 'Internet', sortOrder: 3 },
      { name: 'Phone & mobile', sortOrder: 4 },
      { name: 'Cable & TV', sortOrder: 5 },
    ],
  },
  {
    name: 'Miscellaneous',
    color: '#4A5568',
    kind: 'expense',
    isSystem: false,
    sortOrder: 12,
    children: [
      { name: 'Gifts', sortOrder: 0 },
      { name: 'Donations & charity', sortOrder: 1 },
      { name: 'Bank fees', sortOrder: 2 },
      { name: 'Pets', sortOrder: 3 },
      { name: 'Home improvement', sortOrder: 4 },
    ],
  },
];
