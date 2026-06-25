import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, FormField, Card, CardHeader, CardTitle } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuthLayout } from '../components/AuthLayout';

const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'INR', label: 'INR — Indian Rupee' },
];

export function CreateHouseholdPage() {
  const navigate = useNavigate();
  const { clearTokens } = useAuth();
  const [name, setName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [monthStartDay, setMonthStartDay] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleSignOut() {
    clearTokens();
    navigate('/login', { replace: true });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/households', { name, baseCurrency, monthStartDay });
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof ApiException ? err.message : 'Failed to create household. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle>Set up your household</CardTitle>
        </CardHeader>
        <p className="px-6 pb-4 text-sm text-gray-600">
          Your household is the shared space for your finances. You can invite family members later.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6">
          <FormField
            label="Household name"
            name="householdName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. The Smith Family"
          />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700" htmlFor="baseCurrency">
              Base currency
            </label>
            <select
              id="baseCurrency"
              value={baseCurrency}
              onChange={(e) => setBaseCurrency(e.target.value)}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {CURRENCIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700" htmlFor="monthStartDay">
              Budget month starts on day
            </label>
            <select
              id="monthStartDay"
              value={monthStartDay}
              onChange={(e) => setMonthStartDay(Number(e.target.value))}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500">Day 1–28 only (avoids end-of-month edge cases)</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            Create household
          </Button>
          <p className="text-center text-xs text-gray-400">
            Wrong account?{' '}
            <button type="button" onClick={handleSignOut} className="underline hover:text-gray-600">
              Sign out
            </button>
          </p>
        </form>
      </Card>
    </AuthLayout>
  );
}
