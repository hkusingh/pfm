import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { NavShell, Button, FormField, Card, Badge } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { useAuth } from '../lib/auth';

type Me = { id: string; email: string; name: string; isSiteAdmin: boolean };
type Household = { id: string; name: string };
type Account = {
  id: string;
  name: string;
  type: string;
  source: string;
  institution: string | null;
  mask: string | null;
  balanceMinor: number;
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
type ImportResult = { imported: number; skipped: number; errors: number };

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

function BankIcon({ currency }: { currency: string }) {
  const isNonBase = currency !== 'USD';
  return (
    <div className={`w-9 h-9 rounded-lg flex-shrink-0 ${
      isNonBase
        ? 'bg-gradient-to-br from-amber-500 to-blue-800'
        : 'bg-gradient-to-br from-blue-600 to-blue-900'
    }`} />
  );
}

export function AccountsPage() {
  const { clearTokens } = useAuth();
  const navigate = useNavigate();
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
  const [addMask, setAddMask] = useState('');
  const [addBalance, setAddBalance] = useState('0');
  const [addVisibility, setAddVisibility] = useState<'shared' | 'private' | 'balance_only'>('shared');
  const [addError, setAddError] = useState('');

  const addMutation = useMutation({
    mutationFn: (data: object) =>
      api.post<Account>(`/households/${household!.id}/accounts`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setShowAddForm(false);
      setAddName(''); setAddType('checking'); setAddCurrency('USD');
      setAddInstitution(''); setAddMask(''); setAddBalance('0');
      setAddVisibility('shared'); setAddError('');
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['import-batches'] });
    } catch (err) {
      setImportError(err instanceof ApiException ? err.message : 'Import failed');
      setImportStep('mapping');
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

  async function handleSignOut() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    clearTokens();
    navigate('/login');
  }

  const navItems = [
    { label: 'Dashboard', href: '/dashboard', active: false },
    { label: 'Transactions', href: '/transactions', active: false },
    { label: 'Accounts', href: '/accounts', active: true },
    { label: 'Categories', href: '/categories', active: false },
    { label: 'Household', href: '/settings/household', active: false },
    ...(me?.isSiteAdmin ? [{ label: 'Admin', href: '/admin', active: false }] : []),
  ];

  const own = accounts?.own ?? [];
  const shared = accounts?.shared ?? [];
  const columns = importPreview?.columns ?? [];

  return (
    <NavShell navItems={navItems} userEmail={me?.email ?? ''} onSignOut={handleSignOut}>
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
                <FormField label="Institution (optional)" name="addInstitution" type="text"
                  value={addInstitution} onChange={(e) => setAddInstitution(e.target.value)} placeholder="e.g. Chase" />
                <FormField label="Last 4 digits (optional)" name="addMask" type="text"
                  value={addMask} onChange={(e) => setAddMask(e.target.value)} placeholder="4821" maxLength={4} />
                <FormField label="Opening balance" name="addBalance" type="number"
                  value={addBalance} onChange={(e) => setAddBalance(e.target.value)} step="0.01" />
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
                </p>
              </div>
              <button onClick={resetImport} className="text-xs text-gray-400 hover:text-gray-600">Dismiss</button>
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
                  <div key={acct.id} className="flex items-center justify-between px-5 py-3 gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <BankIcon currency={acct.currency} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {acct.name}
                          {acct.currency !== (household as any)?.baseCurrency &&
                            acct.currency !== 'USD' && (
                              <Badge variant="info" className="ml-1.5 text-[10px]">{acct.currency}</Badge>
                            )}
                        </p>
                        <p className={`text-xs ${LIABILITY_TYPES.has(acct.type) && acct.balanceMinor > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                          {acct.mask ? `····${acct.mask} · ` : ''}
                          {formatBalance(effectiveBalance(acct.balanceMinor, acct.type), acct.currency)}
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
                      <button onClick={() => deleteAccount(acct.id)} className="text-xs text-red-400 hover:text-red-600">
                        Delete
                      </button>
                    </div>
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
                    <BankIcon currency={acct.currency} />
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
    </NavShell>
  );
}
