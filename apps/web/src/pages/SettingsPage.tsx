import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

type Me = { id: string; email: string; name: string; isSiteAdmin?: boolean };

export function SettingsPage() {
  const queryClient = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
  });

  const [nameInput, setNameInput] = useState('');
  const [saved, setSaved] = useState(false);

  const currentName = me?.name ?? '';
  const displayValue = nameInput !== '' ? nameInput : currentName;
  const userInitial = displayValue ? displayValue[0].toUpperCase() : (me?.email?.[0]?.toUpperCase() ?? '?');

  const mutation = useMutation({
    mutationFn: (newName: string) => api.patch<Me>('/auth/profile', { name: newName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setNameInput('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = displayValue.trim();
    if (trimmed && trimmed !== currentName) {
      mutation.mutate(trimmed);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Profile</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Avatar preview */}
          <div className="flex items-center gap-4 mb-2">
            <span className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-600 text-white text-xl font-bold select-none">
              {userInitial}
            </span>
            <div>
              <p className="text-sm font-medium text-gray-900">{displayValue || '—'}</p>
              <p className="text-xs text-gray-500">{me?.email}</p>
            </div>
          </div>

          <div>
            <label htmlFor="display-name" className="block text-sm font-medium text-gray-700 mb-1">
              Display name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayValue}
              onChange={(e) => { setNameInput(e.target.value); setSaved(false); }}
              placeholder="Your name"
              maxLength={100}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={mutation.isPending || !displayValue.trim() || displayValue.trim() === currentName}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {mutation.isPending ? 'Saving…' : 'Save'}
            </button>
            {saved && (
              <span className="text-sm text-green-600 font-medium">Saved!</span>
            )}
            {mutation.isError && (
              <span className="text-sm text-red-600">Failed to save. Try again.</span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
