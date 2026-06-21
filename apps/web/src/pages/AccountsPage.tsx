import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, FormField, Card, Badge } from '@pfm/ui';
import { api, ApiException } from '../lib/api';

type Me = { id: string; email: string; name: string; isSiteAdmin: boolean };
type Household = { id: string; name: string; baseCurrency?: string };
type Account = {
  id: string;
  name: string;
  type: string;
  source: string;
  institution: string | null;
  mask: string | null;
  balanceMinor: number;
  openingBalanceMinor: number;
  balanceAsOfDate: string | null;
  lastTransactionDate: string | null;
  currency: string;
  visibility: 'shared' | 'private' | 'balance_only';
  ownerUserId: string | null;
  ownerName: string | null;
  createdAt: string;
};
type AccountList = { own: Account[]; shared: Account[] };

type ImportPreview = {
  batchId: string;
  format: 'csv' | 'ofx' | 'qfx' | 'pdf';
  columns: string[] | null;
  sampleRows: Record<string, string>[] | null;
  rowCount: number;
  fingerprint: string;
  suggestedMapping: { dateCol: string; merchantCol: string; amountCol?: string; debitCol?: string; creditCol?: string } | null;
  autoMapped: boolean;
};
type FlaggedDuplicate = {
  date: string;
  merchant: string | null;
  amountMinor: number;
  existingId: string;
  existingMerchant: string | null;
  existingCategoryName: string | null;
  existingCategoryColor: string | null;
  existingPostedDate: string;
};
const LS_KEY = 'pfm_pending_duplicate_review';
type ImportResult = { imported: number; skipped: number; errors: number; flagged: FlaggedDuplicate[] };

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'investment', label: 'Investment' },
  { value: 'loan', label: 'Loan' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'other', label: 'Other' },
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'];
const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };

const LIABILITY_TYPES = new Set(['credit_card', 'loan', 'mortgage']);

function effectiveBalance(minor: number, type: string): number {
  // Liabilities store the amount owed as positive; negate for net-worth math
  return LIABILITY_TYPES.has(type) ? -minor : minor;
}

function formatBalance(minor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const abs = Math.abs(minor);
  const major = (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return minor < 0 ? `−${symbol}${major}` : `${symbol}${major}`;
}

const VISIBILITY_LABELS: Record<string, string> = {
  shared: 'Shared',
  private: 'Private',
  balance_only: 'Balance-only',
};

function VisibilityInfo() {
  return (
    <span className="relative group inline-flex items-center ml-1 cursor-help">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
        className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600">
        <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
      </svg>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-lg bg-gray-800 text-white text-xs p-3 opacity-0 group-hover:opacity-100 transition-opacity z-30 shadow-xl leading-relaxed">
        <span className="block font-semibold">Shared</span>
        <span className="text-gray-300">All household members see transactions and balance.</span>
        <span className="block font-semibold mt-2">Private</span>
        <span className="text-gray-300">Only you see this account — nothing is shared.</span>
        <span className="block font-semibold mt-2">Balance-only</span>
        <span className="text-gray-300">Others see your balance in household totals, but individual transactions are hidden.</span>
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </span>
    </span>
  );
}

type ImportBatch = {
  id: string;
  originalName: string;
  accountName: string | null;
  importedCount: number;
  skippedCount: number;
  createdAt: string;
};

function ImportHistory({ householdId }: { householdId: string }) {
  const qc = useQueryClient();
  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['import-batches', householdId],
    queryFn: () => api.get<ImportBatch[]>(`/households/${householdId}/imports`),
    enabled: !!householdId,
  });

  async function deleteBatch(batchId: string, originalName: string) {
    if (!confirm(`Delete all transactions from "${originalName}"? This cannot be undone.`)) return;
    await api.delete(`/households/${householdId}/imports/${batchId}`);
    qc.invalidateQueries({ queryKey: ['import-batches', householdId] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  }

  if (isLoading || batches.length === 0) return null;

  return (
    <Card padding="none">
      <div className="px-5 pt-4 pb-2">
        <p className="text-sm font-semibold text-gray-900">Import history</p>
      </div>
      <div className="divide-y divide-gray-100">
        {batches.map((b) => (
          <div key={b.id} className="flex items-center justify-between px-5 py-3 gap-3">
            <div className="min-w-0">
              <p className="text-sm text-gray-900 truncate">{b.originalName}</p>
              <p className="text-xs text-gray-500">
                {b.accountName ? `${b.accountName} · ` : ''}
                {b.importedCount} imported · {b.skippedCount} skipped ·{' '}
                {new Date(b.createdAt).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => deleteBatch(b.id, b.originalName)}
              className="text-xs text-red-400 hover:text-red-600 flex-shrink-0"
            >
              Delete transactions
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

type KnownInstitution = {
  name: string;
  domain: string;
  group: 'bank' | 'credit_card' | 'investment' | 'other';
  color: string; // brand color used in fallback avatar
};

export const KNOWN_INSTITUTIONS: KnownInstitution[] = [
  // Banks
  { name: 'Ally Bank',              domain: 'ally.com',               group: 'bank',        color: '#6B2D8B' },
  { name: 'Bank of America',        domain: 'bankofamerica.com',       group: 'bank',        color: '#E31837' },
  { name: 'Capital One',            domain: 'capitalone.com',          group: 'bank',        color: '#CF1020' },
  { name: 'Chase',                  domain: 'chase.com',               group: 'bank',        color: '#117ACA' },
  { name: 'Citibank',               domain: 'citi.com',                group: 'bank',        color: '#003A80' },
  { name: 'Citizens Bank',          domain: 'citizensbank.com',        group: 'bank',        color: '#008000' },
  { name: 'Fifth Third Bank',       domain: '53.com',                  group: 'bank',        color: '#006236' },
  { name: 'Goldman Sachs (Marcus)', domain: 'marcus.com',              group: 'bank',        color: '#2C2C2C' },
  { name: 'HSBC',                   domain: 'hsbc.com',                group: 'bank',        color: '#DB0011' },
  { name: 'Huntington Bank',        domain: 'huntington.com',          group: 'bank',        color: '#00833E' },
  { name: 'KeyBank',                domain: 'key.com',                 group: 'bank',        color: '#CC0000' },
  { name: 'Navy Federal CU',        domain: 'navyfcu.org',             group: 'bank',        color: '#002B5C' },
  { name: 'PNC Bank',               domain: 'pnc.com',                 group: 'bank',        color: '#F58025' },
  { name: 'Regions Bank',           domain: 'regions.com',             group: 'bank',        color: '#005587' },
  { name: 'SoFi',                   domain: 'sofi.com',                group: 'bank',        color: '#00A875' },
  { name: 'Synchrony Bank',         domain: 'synchrony.com',           group: 'bank',        color: '#005596' },
  { name: 'TD Bank',                domain: 'td.com',                  group: 'bank',        color: '#2B8A2B' },
  { name: 'Truist',                 domain: 'truist.com',              group: 'bank',        color: '#4B0082' },
  { name: 'U.S. Bank',              domain: 'usbank.com',              group: 'bank',        color: '#002B5C' },
  { name: 'USAA',                   domain: 'usaa.com',                group: 'bank',        color: '#003366' },
  { name: 'Wells Fargo',            domain: 'wellsfargo.com',          group: 'bank',        color: '#CD2E25' },
  // Credit cards
  { name: 'American Express',       domain: 'americanexpress.com',     group: 'credit_card', color: '#2E77BC' },
  { name: 'Barclays',               domain: 'barclays.com',            group: 'credit_card', color: '#00AEEF' },
  { name: 'Discover',               domain: 'discover.com',            group: 'credit_card', color: '#F76F20' },
  // Investment
  { name: 'Charles Schwab',         domain: 'schwab.com',              group: 'investment',  color: '#00A0DF' },
  { name: 'E*TRADE',                domain: 'etrade.com',              group: 'investment',  color: '#6633CC' },
  { name: 'Fidelity',               domain: 'fidelity.com',            group: 'investment',  color: '#006800' },
  { name: 'Merrill',                domain: 'merrilledge.com',         group: 'investment',  color: '#CC0000' },
  { name: 'Morgan Stanley',         domain: 'morganstanley.com',       group: 'investment',  color: '#003366' },
  { name: 'Robinhood',              domain: 'robinhood.com',           group: 'investment',  color: '#00C805' },
  { name: 'Vanguard',               domain: 'vanguard.com',            group: 'investment',  color: '#8B1A1A' },
];

const INSTITUTION_GROUP_LABELS: Record<KnownInstitution['group'], string> = {
  bank: 'Banks',
  credit_card: 'Credit Cards',
  investment: 'Investment',
  other: 'Other',
};

function getKnownInstitution(institution: string | null): KnownInstitution | null {
  if (!institution) return null;
  const exact = KNOWN_INSTITUTIONS.find((i) => i.name === institution);
  if (exact) return exact;
  const lower = institution.toLowerCase();
  return KNOWN_INSTITUTIONS.find((i) => lower.includes(i.name.toLowerCase())) ?? null;
}

// Logos are pre-downloaded to public/logos/ — slug is the first segment of the domain.
function localLogoPath(domain: string): string {
  return `/logos/${domain.split('.')[0]}.png`;
}

function InstitutionLogo({ institution, name }: { institution: string | null; name: string }) {
  const known = getKnownInstitution(institution);
  const [failed, setFailed] = useState(false);
  const seed = institution ?? name;
  const bgColor = known?.color ?? '#4B5563';

  if (known && !failed) {
    return (
      <div className="w-9 h-9 rounded-lg flex-shrink-0 overflow-hidden bg-white border border-gray-100 shadow-sm flex items-center justify-center">
        <img
          src={localLogoPath(known.domain)}
          alt={known.name}
          className="w-8 h-8 object-contain"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center"
      style={{ backgroundColor: bgColor }}
    >
      <span className="text-white text-sm font-bold select-none">
        {seed.charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

export function AccountsPage() {
  const qc = useQueryClient();

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me') });
  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });
  const { data: accounts, isLoading } = useQuery({
    queryKey: ['accounts', household?.id],
    queryFn: () => api.get<AccountList>(`/households/${household!.id}/accounts`),
    enabled: !!household?.id,
  });

  // ─── Add account form state ──────────────────────────────────────────────────

  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState('');
  const [addType, setAddType] = useState('checking');
  const [addCurrency, setAddCurrency] = useState('USD');
  const [addInstitution, setAddInstitution] = useState('');
  const [addInstitutionCustom, setAddInstitutionCustom] = useState(false);
  const [addMask, setAddMask] = useState('');
  const [addBalance, setAddBalance] = useState('0');
  const [addBalanceAsOf, setAddBalanceAsOf] = useState('');
  const [addVisibility, setAddVisibility] = useState<'shared' | 'private' | 'balance_only'>('shared');
  const [addError, setAddError] = useState('');

  const addMutation = useMutation({
    mutationFn: (data: object) =>
      api.post<Account>(`/households/${household!.id}/accounts`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setShowAddForm(false);
      setAddName(''); setAddType('checking'); setAddCurrency('USD');
      setAddInstitution(''); setAddInstitutionCustom(false); setAddMask(''); setAddBalance('0');
      setAddBalanceAsOf(''); setAddVisibility('shared'); setAddError('');
    },
    onError: (err) => setAddError(err instanceof ApiException ? err.message : 'Failed to create account.'),
  });

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    const balanceCents = Math.round(parseFloat(addBalance || '0') * 100);
    addMutation.mutate({
      name: addName,
      type: addType,
      currency: addCurrency,
      institution: addInstitution || undefined,
      mask: addMask || undefined,
      visibility: addVisibility,
      initialBalanceMinor: isNaN(balanceCents) ? 0 : balanceCents,
      balanceAsOfDate: addBalanceAsOf || undefined,
    });
  }

  // ─── Import wizard state ─────────────────────────────────────────────────────

  type ImportStep = 'idle' | 'uploading' | 'mapping' | 'committing' | 'done' | 'error';
  const [importStep, setImportStep] = useState<ImportStep>('idle');
  const [importFileName, setImportFileName] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importAccountId, setImportAccountId] = useState('');
  const [importDateCol, setImportDateCol] = useState('');
  const [importMerchantCol, setImportMerchantCol] = useState('');
  const [importAmountCol, setImportAmountCol] = useState('');
  const [importInvert, setImportInvert] = useState(false);
  const [importSplitCols, setImportSplitCols] = useState(false);
  const [importDebitCol, setImportDebitCol] = useState('');
  const [importCreditCol, setImportCreditCol] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState('');
  // Flagged duplicate review state — seeded from localStorage so it survives navigation
  const [flaggedRows, setFlaggedRows] = useState<FlaggedDuplicate[]>(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) ?? 'null')?.rows ?? []; } catch { return []; }
  });
  const [flaggedBatchId, setFlaggedBatchId] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) ?? 'null')?.batchId ?? ''; } catch { return ''; }
  });
  const [flaggedSelected, setFlaggedSelected] = useState<Set<number>>(
    () => new Set((flaggedRows ?? []).map((_, i) => i)),
  );
  const [flaggedSubmitting, setFlaggedSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep localStorage in sync whenever flaggedRows changes
  useEffect(() => {
    if (flaggedRows.length > 0) {
      localStorage.setItem(LS_KEY, JSON.stringify({ batchId: flaggedBatchId, rows: flaggedRows }));
    } else {
      localStorage.removeItem(LS_KEY);
    }
  }, [flaggedRows, flaggedBatchId]);

  function getSampleValue(col: string): string {
    return importPreview?.sampleRows?.[0]?.[col] ?? '';
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !household) return;
    setImportFileName(file.name);
    setImportStep('uploading');
    setImportError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      const preview = await api.upload<ImportPreview>(
        `/households/${household.id}/import/preview`,
        formData,
      );

      setImportPreview(preview);
      // Pre-fill mapping from suggestion
      const sm = preview.suggestedMapping;
      setImportDateCol(sm?.dateCol ?? preview.columns?.[0] ?? '');
      setImportMerchantCol(sm?.merchantCol ?? preview.columns?.[1] ?? '');
      if (sm?.debitCol || sm?.creditCol) {
        setImportSplitCols(true);
        setImportDebitCol(sm?.debitCol ?? '');
        setImportCreditCol(sm?.creditCol ?? '');
      } else {
        setImportSplitCols(false);
        setImportAmountCol(sm?.amountCol ?? preview.columns?.[2] ?? '');
      }
      setImportAccountId(accounts?.own?.[0]?.id ?? '');
      setImportStep('mapping');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Upload failed');
      setImportStep('error');
    }

    // Reset input so same file can be re-chosen
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function submitImport() {
    if (!importPreview || !household || !importAccountId) return;
    setImportStep('committing');
    setImportError('');

    try {
      const body: Record<string, unknown> = {
        batchId: importPreview.batchId,
        accountId: importAccountId,
      };
      if (!importPreview.autoMapped) {
        if (importSplitCols) {
          body.mapping = {
            dateCol: importDateCol,
            merchantCol: importMerchantCol,
            debitCol: importDebitCol,
            creditCol: importCreditCol,
          };
        } else {
          body.mapping = {
            dateCol: importDateCol,
            merchantCol: importMerchantCol,
            amountCol: importAmountCol,
            invertAmount: importInvert,
          };
        }
      }
      const result = await api.post<ImportResult>(
        `/households/${household.id}/import/commit`,
        body,
      );
      setImportResult(result);
      setImportStep('done');
      if (result.flagged?.length > 0) {
        setFlaggedRows(result.flagged);
        setFlaggedBatchId(importPreview.batchId);
        setFlaggedSelected(new Set(result.flagged.map((_, i) => i)));
      }
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['import-batches'] });
    } catch (err) {
      setImportError(err instanceof ApiException ? err.message : 'Import failed');
      setImportStep('mapping');
    }
  }

  async function submitFlagged() {
    if (!household || flaggedRows.length === 0) return;
    const toImport = flaggedRows.filter((_, i) => flaggedSelected.has(i));
    if (toImport.length === 0) {
      setFlaggedRows([]);
      return;
    }
    setFlaggedSubmitting(true);
    try {
      await api.post(`/households/${household.id}/import/${flaggedBatchId}/confirm-flagged`, {
        rows: toImport.map((r) => ({ date: r.date, merchant: r.merchant, amountMinor: r.amountMinor })),
      });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['import-batches'] });
    } finally {
      setFlaggedSubmitting(false);
      setFlaggedRows([]);
    }
  }

  function resetImport() {
    setImportStep('idle');
    setImportPreview(null);
    setImportResult(null);
    setImportError('');
    setImportFileName('');
    setImportSplitCols(false);
    setImportDebitCol('');
    setImportCreditCol('');
    setFlaggedRows([]);
    setFlaggedBatchId('');
    setFlaggedSelected(new Set());
  }

  // ─── Edit account state ──────────────────────────────────────────────────────

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('checking');
  const [editInstitution, setEditInstitution] = useState('');
  const [editInstitutionCustom, setEditInstitutionCustom] = useState(false);
  const [editMask, setEditMask] = useState('');
  const [editBalance, setEditBalance] = useState('');
  const [editBalanceAsOf, setEditBalanceAsOf] = useState('');
  const [editError, setEditError] = useState('');

  function openEdit(acct: Account) {
    setEditingId(acct.id);
    setEditName(acct.name);
    setEditType(acct.type);
    const isKnown = KNOWN_INSTITUTIONS.some((i) => i.name === acct.institution);
    setEditInstitution(acct.institution ?? '');
    setEditInstitutionCustom(!!acct.institution && !isKnown);
    setEditMask(acct.mask ?? '');
    setEditBalance((Math.abs(acct.openingBalanceMinor) / 100).toFixed(2));
    setEditBalanceAsOf(acct.balanceAsOfDate ?? '');
    setEditError('');
  }

  function closeEdit() {
    setEditingId(null);
    setEditError('');
  }

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      api.patch<Account>(`/households/${household!.id}/accounts/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      closeEdit();
    },
    onError: (err) => setEditError(err instanceof ApiException ? err.message : 'Failed to save.'),
  });

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    const balanceCents = Math.round(parseFloat(editBalance || '0') * 100);
    editMutation.mutate({
      id: editingId,
      data: {
        name: editName,
        type: editType,
        institution: editInstitution || undefined,
        mask: editMask || undefined,
        balanceMinor: isNaN(balanceCents) ? 0 : balanceCents,
        balanceAsOfDate: editBalanceAsOf || null,
      },
    });
  }

  // ─── Account changes ─────────────────────────────────────────────────────────

  async function changeVisibility(accountId: string, visibility: string) {
    if (!household) return;
    await api.patch(`/households/${household.id}/accounts/${accountId}/visibility`, { visibility });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  }

  async function deleteAccount(accountId: string) {
    if (!household) return;
    if (!confirm('Delete this account? All its transactions will also be deleted.')) return;
    await api.delete(`/households/${household.id}/accounts/${accountId}`);
    qc.invalidateQueries({ queryKey: ['accounts'] });
  }

  const own = accounts?.own ?? [];
  const shared = accounts?.shared ?? [];
  const columns = importPreview?.columns ?? [];

  return (
    <div className="p-6 max-w-4xl space-y-5">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Accounts</h1>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              ↥ Import statement
            </Button>
            <Button onClick={() => setShowAddForm((v) => !v)}>
              + Add account
            </Button>
          </div>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.ofx,.qfx,.pdf"
          className="hidden"
          onChange={handleFileChosen}
        />

        {/* Add an account dashed card */}
        <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/40 p-5">
          <p className="text-sm font-semibold text-gray-900 mb-4">Add an account</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            {/* Upload a statement */}
            <div
              className="bg-white border-2 border-emerald-600 rounded-xl p-5 text-center cursor-pointer hover:bg-emerald-50/30 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-600 to-blue-800 mx-auto mb-3" />
              <p className="font-semibold text-sm text-gray-900 mb-1">
                Upload a statement{' '}
                <Badge variant="success" className="text-[10px]">Phase 1</Badge>
              </p>
              <p className="text-xs text-gray-500 mb-3">
                Upload CSV, OFX, QFX, or PDF downloaded from your bank. No login stored.
              </p>
              <Button variant="secondary" className="text-xs px-3 py-1" type="button">
                Choose file
              </Button>
            </div>

            {/* Connect automatically — Phase 2 */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 text-center opacity-50 select-none">
              <div className="w-9 h-9 rounded-lg bg-gray-300 mx-auto mb-3" />
              <p className="font-semibold text-sm text-gray-900 mb-1">
                Connect automatically{' '}
                <Badge variant="info" className="text-[10px]">Phase 2</Badge>
              </p>
              <p className="text-xs text-gray-500 mb-3">
                Link your bank/card via Plaid for live updates. Coming in Phase 2.
              </p>
              <Button variant="secondary" disabled className="text-xs px-3 py-1">
                Connect
              </Button>
            </div>
          </div>

          {/* Manual account form */}
          {showAddForm && (
            <form onSubmit={submitAdd} className="mt-4 border-t border-blue-100 pt-4 space-y-4">
              <p className="text-sm font-semibold text-gray-800">Add a manual account</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Account name" name="addName" type="text" value={addName}
                  onChange={(e) => setAddName(e.target.value)} placeholder="e.g. Chase Checking" required />
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Type</label>
                  <select value={addType} onChange={(e) => setAddType(e.target.value)}
                    className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Currency</label>
                  <select value={addCurrency} onChange={(e) => setAddCurrency(e.target.value)}
                    className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="flex items-center text-sm font-medium text-gray-700">
                    Visibility <VisibilityInfo />
                  </label>
                  <select value={addVisibility} onChange={(e) => setAddVisibility(e.target.value as typeof addVisibility)}
                    className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option value="shared">Shared</option>
                    <option value="private">Private</option>
                    <option value="balance_only">Balance-only</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Institution</label>
                  <select
                    value={addInstitutionCustom ? '__other__' : (addInstitution || '')}
                    onChange={(e) => {
                      if (e.target.value === '__other__') {
                        setAddInstitutionCustom(true);
                        setAddInstitution('');
                      } else {
                        setAddInstitutionCustom(false);
                        setAddInstitution(e.target.value);
                      }
                    }}
                    className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">— Select institution —</option>
                    {(['bank', 'credit_card', 'investment'] as const).map((group) => (
                      <optgroup key={group} label={INSTITUTION_GROUP_LABELS[group]}>
                        {KNOWN_INSTITUTIONS.filter((i) => i.group === group).map((i) => (
                          <option key={i.name} value={i.name}>{i.name}</option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="__other__">Other (specify)…</option>
                  </select>
                  {addInstitutionCustom && (
                    <input
                      type="text"
                      value={addInstitution}
                      onChange={(e) => setAddInstitution(e.target.value)}
                      placeholder="Institution name"
                      autoFocus
                      className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 py-2 text-sm mt-1"
                    />
                  )}
                </div>
                <FormField label="Last 4 digits (optional)" name="addMask" type="text"
                  value={addMask} onChange={(e) => setAddMask(e.target.value)} placeholder="4821" maxLength={4} />
                <FormField label="Opening balance" name="addBalance" type="number"
                  value={addBalance} onChange={(e) => setAddBalance(e.target.value)} step="0.01" />
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">
                    Balance as of
                  </label>
                  <input
                    type="date"
                    value={addBalanceAsOf}
                    onChange={(e) => setAddBalanceAsOf(e.target.value)}
                    className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-gray-400">Enter the balance at end of this date; transactions on or before it are treated as already included.</p>
                </div>
              </div>
              {addError && <p className="text-sm text-red-600">{addError}</p>}
              <div className="flex gap-2">
                <Button type="submit" loading={addMutation.isPending}>Add account</Button>
                <Button type="button" variant="secondary" onClick={() => { setShowAddForm(false); setAddError(''); }}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* ─── Import wizard cards ─────────────────────────────────────────────── */}

        {importStep === 'uploading' && (
          <Card padding="md">
            <p className="text-sm text-gray-600 flex items-center gap-2">
              <span className="animate-spin inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full" />
              Uploading {importFileName}…
            </p>
          </Card>
        )}

        {importStep === 'error' && (
          <Card padding="md">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-red-600">{importError || 'Upload failed'}</p>
              <button onClick={resetImport} className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0">Dismiss</button>
            </div>
          </Card>
        )}

        {(importStep === 'mapping' || importStep === 'committing') && importPreview && (
          <Card padding="none">
            <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">
                Import statement — {importPreview.autoMapped ? 'select account' : 'map columns'}{' '}
                <span className="text-gray-400 font-normal">
                  {importFileName} · {importPreview.rowCount} rows
                </span>
              </p>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* CSV column mapping table */}
              {!importPreview.autoMapped && columns.length > 0 && (
                <div className="space-y-3">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-200">
                        <th className="pb-2 pr-4">Your file column</th>
                        <th className="pb-2 pr-4">Maps to</th>
                        <th className="pb-2">Sample</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="py-2 pr-4">
                          <select
                            value={importDateCol}
                            onChange={(e) => setImportDateCol(e.target.value)}
                            className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white w-full"
                          >
                            {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="py-2 pr-4 text-gray-700 font-medium">Date ✓</td>
                        <td className="py-2 text-gray-400 text-xs">{getSampleValue(importDateCol)}</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4">
                          <select
                            value={importMerchantCol}
                            onChange={(e) => setImportMerchantCol(e.target.value)}
                            className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white w-full"
                          >
                            <option value="">(none)</option>
                            {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="py-2 pr-4 text-gray-700 font-medium">Merchant ✓</td>
                        <td className="py-2 text-gray-400 text-xs">{getSampleValue(importMerchantCol)}</td>
                      </tr>
                      {importSplitCols ? (
                        <>
                          <tr>
                            <td className="py-2 pr-4">
                              <select
                                value={importDebitCol}
                                onChange={(e) => setImportDebitCol(e.target.value)}
                                className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white w-full"
                              >
                                <option value="">(none)</option>
                                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </td>
                            <td className="py-2 pr-4 text-gray-700 font-medium">Debit (outflow) ✓</td>
                            <td className="py-2 text-gray-400 text-xs">{getSampleValue(importDebitCol)}</td>
                          </tr>
                          <tr>
                            <td className="py-2 pr-4">
                              <select
                                value={importCreditCol}
                                onChange={(e) => setImportCreditCol(e.target.value)}
                                className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white w-full"
                              >
                                <option value="">(none)</option>
                                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </td>
                            <td className="py-2 pr-4 text-gray-700 font-medium">Credit (inflow) ✓</td>
                            <td className="py-2 text-gray-400 text-xs">{getSampleValue(importCreditCol)}</td>
                          </tr>
                        </>
                      ) : (
                        <tr>
                          <td className="py-2 pr-4">
                            <select
                              value={importAmountCol}
                              onChange={(e) => setImportAmountCol(e.target.value)}
                              className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white w-full"
                            >
                              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="py-2 pr-4 text-gray-700 font-medium">Amount ✓</td>
                          <td className="py-2 text-gray-400 text-xs">{getSampleValue(importAmountCol)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={importSplitCols}
                      onChange={(e) => {
                        setImportSplitCols(e.target.checked);
                        if (e.target.checked && !importDebitCol) setImportDebitCol(columns[2] ?? '');
                        if (e.target.checked && !importCreditCol) setImportCreditCol(columns[3] ?? '');
                      }}
                      className="rounded border-gray-300"
                    />
                    This file uses separate Debit and Credit columns
                  </label>
                </div>
              )}

              {importPreview.autoMapped && importPreview.format !== 'pdf' && (
                <p className="text-sm text-gray-600">
                  OFX/QFX file — columns mapped automatically ({importPreview.rowCount} transactions found).
                </p>
              )}

              {importPreview.format === 'pdf' && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800 leading-relaxed">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0 mt-0.5">
                      <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                    </svg>
                    <span>
                      <strong>PDF parsing is best-effort.</strong> Transactions are detected by scanning for date + amount patterns.
                      Review the sample rows below before importing — if they look wrong, export as CSV from your bank instead.
                    </span>
                  </div>

                  {importPreview.rowCount === 0 ? (
                    <p className="text-sm text-red-600">
                      No transactions detected in this PDF. Try exporting as CSV from your bank.
                    </p>
                  ) : (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-2">
                        {importPreview.rowCount} transactions detected — first 5 rows:
                      </p>
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="text-left text-gray-400 border-b border-gray-200">
                            <th className="pb-1.5 pr-4">Date</th>
                            <th className="pb-1.5 pr-4">Merchant</th>
                            <th className="pb-1.5 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(importPreview.sampleRows ?? []).map((row, i) => (
                            <tr key={i}>
                              <td className="py-1.5 pr-4 text-gray-700">{row.date}</td>
                              <td className="py-1.5 pr-4 text-gray-600 max-w-[200px] truncate">{row.merchant || '—'}</td>
                              <td className="py-1.5 text-right text-gray-700">{row.amount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Account + invert amount row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Import into account</label>
                  <select
                    value={importAccountId}
                    onChange={(e) => setImportAccountId(e.target.value)}
                    className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    {own.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}{a.mask ? ` ····${a.mask}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {!importPreview.autoMapped && !importSplitCols && (
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={importInvert}
                        onChange={(e) => setImportInvert(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      Invert sign (expenses are positive in this file)
                    </label>
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-500 leading-relaxed bg-gray-50 rounded-lg px-3 py-2">
                Duplicate transactions already on file are detected and skipped automatically.
                Each account has its own currency; amounts are shown as-is and not converted.
              </p>

              {importError && <p className="text-sm text-red-600">{importError}</p>}

              <div className="flex gap-2">
                <Button
                  onClick={submitImport}
                  loading={importStep === 'committing'}
                  disabled={!importAccountId || importPreview.rowCount === 0}
                >
                  Import {importPreview.rowCount} transactions
                </Button>
                <Button variant="secondary" onClick={resetImport}>Cancel</Button>
              </div>
            </div>
          </Card>
        )}

        {importStep === 'done' && importResult && (
          <Card padding="md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900 mb-1">Import complete</p>
                <p className="text-sm text-gray-600">
                  <span className="text-emerald-700 font-medium">{importResult.imported} imported</span>
                  {' · '}
                  <span className="text-gray-500">{importResult.skipped} duplicate{importResult.skipped !== 1 ? 's' : ''} skipped</span>
                  {importResult.errors > 0 && (
                    <span className="text-red-500"> · {importResult.errors} error{importResult.errors !== 1 ? 's' : ''}</span>
                  )}
                  {importResult.flagged?.length > 0 && (
                    <span className="text-amber-600"> · {importResult.flagged.length} need review</span>
                  )}
                </p>
              </div>
              <button onClick={resetImport} className="text-xs text-gray-400 hover:text-gray-600">Dismiss</button>
            </div>
          </Card>
        )}

        {/* Fuzzy-duplicate review panel — persists across navigation via localStorage */}
        {flaggedRows.length > 0 && (
          <Card padding="md">
            <p className="text-sm font-semibold text-gray-900 mb-1">
              Review possible duplicates
            </p>
            <p className="text-xs text-gray-500 mb-4">
              These incoming transactions match an existing entry by date and amount but have slightly different descriptions (banks sometimes vary merchant names between exports). Tick the ones that are genuinely separate charges and click "Import selected".
            </p>

            <div className="space-y-3 mb-4">
              {flaggedRows.map((row, i) => {
                const checked = flaggedSelected.has(i);
                const fmt = (minor: number) =>
                  (minor < 0 ? '−$' : '+$') + (Math.abs(minor) / 100).toFixed(2);
                const fmtDate = (d: string) =>
                  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

                return (
                  <div
                    key={i}
                    className={`rounded-lg border text-xs transition-colors ${checked ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}
                  >
                    {/* Header row with checkbox */}
                    <label className="flex items-center gap-2 px-3 py-2 border-b border-inherit cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setFlaggedSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            return next;
                          });
                        }}
                      />
                      <span className={`font-medium ${checked ? 'text-amber-800' : 'text-gray-500'}`}>
                        {checked ? 'Import as a separate transaction' : 'Skip (treat as duplicate)'}
                      </span>
                    </label>

                    {/* Side-by-side transaction cards */}
                    <div className="grid grid-cols-2 divide-x divide-gray-200">
                      {/* Existing transaction */}
                      <div className="px-3 py-2.5 space-y-1">
                        <p className="font-medium text-gray-400 uppercase tracking-wide text-[10px]">Already recorded</p>
                        <p className="font-semibold text-gray-900 truncate">{row.existingMerchant ?? <span className="italic text-gray-400">No merchant</span>}</p>
                        <p className="text-gray-500">{fmtDate(row.existingPostedDate)}</p>
                        {row.existingCategoryName ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: row.existingCategoryColor ? row.existingCategoryColor + '22' : '#e5e7eb', color: row.existingCategoryColor ?? '#6b7280' }}>
                            {row.existingCategoryName}
                          </span>
                        ) : (
                          <span className="text-gray-400 italic">Uncategorized</span>
                        )}
                        <p className={`font-semibold tabular-nums ${row.amountMinor < 0 ? 'text-gray-900' : 'text-emerald-600'}`}>{fmt(row.amountMinor)}</p>
                      </div>

                      {/* Incoming transaction */}
                      <div className={`px-3 py-2.5 space-y-1 ${checked ? '' : 'opacity-50'}`}>
                        <p className="font-medium text-gray-400 uppercase tracking-wide text-[10px]">From this import</p>
                        <p className="font-semibold text-gray-900 truncate">{row.merchant ?? <span className="italic text-gray-400">No merchant</span>}</p>
                        <p className="text-gray-500">{fmtDate(row.date)}</p>
                        <span className="text-gray-400 italic">Not yet categorized</span>
                        <p className={`font-semibold tabular-nums ${row.amountMinor < 0 ? 'text-gray-900' : 'text-emerald-600'}`}>{fmt(row.amountMinor)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={flaggedSubmitting}
                disabled={flaggedSelected.size === 0}
                onClick={submitFlagged}
              >
                Import selected ({flaggedSelected.size})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFlaggedRows([])}>
                Skip all (treat all as duplicates)
              </Button>
            </div>
          </Card>
        )}

        {/* Your accounts */}
        {!isLoading && (
          <Card padding="none">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">
                {me?.name ? `${me.name}'s accounts` : 'Your accounts'}
                <span className="ml-2 text-xs font-normal text-blue-600">you</span>
              </p>
            </div>
            {own.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-gray-400">No accounts yet. Add one above.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {own.map((acct) => (
                  <div key={acct.id}>
                    <div className="flex items-center justify-between px-5 py-3 gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <InstitutionLogo institution={acct.institution} name={acct.name} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {acct.name}
                            {acct.currency !== household?.baseCurrency &&
                              acct.currency !== 'USD' && (
                                <Badge variant="info" className="ml-1.5 text-[10px]">{acct.currency}</Badge>
                              )}
                          </p>
                          <p className={`text-xs ${LIABILITY_TYPES.has(acct.type) && acct.balanceMinor > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                            {acct.mask ? `····${acct.mask} · ` : ''}
                            {formatBalance(effectiveBalance(acct.balanceMinor, acct.type), acct.currency)}
                            {(acct.lastTransactionDate ?? acct.balanceAsOfDate) && (
                              <span className="text-gray-400"> · as of {new Date((acct.lastTransactionDate ?? acct.balanceAsOfDate)! + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            )}
                            {acct.currency !== 'USD' && (
                              <span className="text-gray-400"> · shown natively, not in USD totals</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="flex items-center gap-1">
                          <select
                            value={acct.visibility}
                            onChange={(e) => changeVisibility(acct.id, e.target.value)}
                            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700"
                          >
                            <option value="shared">Shared ✓</option>
                            <option value="private">Private</option>
                            <option value="balance_only">Balance-only</option>
                          </select>
                          <VisibilityInfo />
                        </div>
                        <button
                          onClick={() => editingId === acct.id ? closeEdit() : openEdit(acct)}
                          className="text-xs text-blue-500 hover:text-blue-700"
                        >
                          {editingId === acct.id ? 'Cancel' : 'Edit'}
                        </button>
                        <button onClick={() => deleteAccount(acct.id)} className="text-xs text-red-400 hover:text-red-600">
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Inline edit panel */}
                    {editingId === acct.id && (
                      <div className="px-5 pb-4">
                        <form
                          onSubmit={submitEdit}
                          className="border border-blue-100 bg-blue-50 rounded-lg px-4 py-3 space-y-3"
                        >
                          <p className="text-xs font-semibold text-gray-800">Edit account</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-gray-600">Name</label>
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                required
                                className="block w-full h-[32px] rounded-md border border-gray-300 px-2 text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-gray-600">Type</label>
                              <select
                                value={editType}
                                onChange={(e) => setEditType(e.target.value)}
                                className="block w-full h-[32px] rounded-md border border-gray-300 px-2 text-sm bg-white"
                              >
                                {ACCOUNT_TYPES.map((t) => (
                                  <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-gray-600">Institution</label>
                              <select
                                value={editInstitutionCustom ? '__other__' : (editInstitution || '')}
                                onChange={(e) => {
                                  if (e.target.value === '__other__') {
                                    setEditInstitutionCustom(true);
                                    setEditInstitution('');
                                  } else {
                                    setEditInstitutionCustom(false);
                                    setEditInstitution(e.target.value);
                                  }
                                }}
                                className="block w-full h-[32px] rounded-md border border-gray-300 px-2 text-sm bg-white"
                              >
                                <option value="">— Select institution —</option>
                                {(['bank', 'credit_card', 'investment'] as const).map((group) => (
                                  <optgroup key={group} label={INSTITUTION_GROUP_LABELS[group]}>
                                    {KNOWN_INSTITUTIONS.filter((i) => i.group === group).map((i) => (
                                      <option key={i.name} value={i.name}>{i.name}</option>
                                    ))}
                                  </optgroup>
                                ))}
                                <option value="__other__">Other (specify)…</option>
                              </select>
                              {editInstitutionCustom && (
                                <input
                                  type="text"
                                  value={editInstitution}
                                  onChange={(e) => setEditInstitution(e.target.value)}
                                  placeholder="Institution name"
                                  autoFocus
                                  className="block w-full h-[32px] rounded-md border border-gray-300 px-2 text-sm mt-1"
                                />
                              )}
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-gray-600">Last 4 digits</label>
                              <input
                                type="text"
                                value={editMask}
                                onChange={(e) => setEditMask(e.target.value)}
                                placeholder="4821"
                                maxLength={4}
                                className="block w-full h-[32px] rounded-md border border-gray-300 px-2 text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-gray-600">
                                Opening balance ({acct.currency})
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={editBalance}
                                onChange={(e) => setEditBalance(e.target.value)}
                                className="block w-full h-[32px] rounded-md border border-gray-300 px-2 text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-medium text-gray-600">
                                Balance as of
                              </label>
                              <input
                                type="date"
                                value={editBalanceAsOf}
                                onChange={(e) => setEditBalanceAsOf(e.target.value)}
                                className="block w-full h-[32px] rounded-md border border-gray-300 px-2 text-sm"
                              />
                              <p className="text-xs text-gray-400">Enter the balance at end of this date; transactions on or before it are treated as already included.</p>
                            </div>
                          </div>
                          {editError && <p className="text-xs text-red-600">{editError}</p>}
                          <div className="flex gap-2 pt-1">
                            <button
                              type="submit"
                              disabled={editMutation.isPending}
                              className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                            >
                              {editMutation.isPending ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={closeEdit}
                              className="px-3 py-1 text-xs font-medium border border-gray-300 rounded-md hover:bg-white"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Shared with you */}
        {shared.length > 0 && (
          <Card padding="none">
            <div className="px-5 pt-4 pb-2">
              <p className="text-sm font-semibold text-gray-900">
                Shared with you
                <span className="ml-2 text-xs font-normal text-blue-600">from household</span>
              </p>
            </div>
            <div className="divide-y divide-gray-100">
              {shared.map((acct) => (
                <div key={acct.id} className="flex items-center justify-between px-5 py-3 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <InstitutionLogo institution={acct.institution} name={acct.name} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {acct.name}{' '}
                        <Badge variant={acct.visibility === 'shared' ? 'success' : 'info'} className="text-[10px]">
                          {VISIBILITY_LABELS[acct.visibility]}
                        </Badge>
                      </p>
                      <p className={`text-xs ${LIABILITY_TYPES.has(acct.type) && acct.balanceMinor > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        {acct.ownerName ? `Connected by ${acct.ownerName} · ` : ''}
                        {acct.visibility === 'balance_only'
                          ? 'Counts toward totals · items hidden'
                          : formatBalance(effectiveBalance(acct.balanceMinor, acct.type), acct.currency)}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">view only</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Import history */}
        <ImportHistory householdId={household?.id ?? ''} />

        {/* Currency note */}
        <div className="bg-blue-50 border-l-4 border-blue-300 rounded-r-lg px-4 py-3 text-xs text-gray-700 leading-relaxed">
          <span className="font-semibold">Currency:</span> each account keeps its own currency
          (USD / EUR / GBP / INR). Amounts are never converted in Phase 1 — non-base-currency
          accounts appear natively and in a separate per-currency breakdown rather than being
          blended into the base-currency totals.
        </div>

      </div>
  );
}
