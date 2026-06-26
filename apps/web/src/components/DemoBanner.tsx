import { useAuth } from '../lib/auth';
import { useNavigate } from 'react-router-dom';

export function DemoBanner() {
  const { isDemo, clearTokens } = useAuth();
  const navigate = useNavigate();

  if (!isDemo) return null;

  function exitTour() {
    clearTokens();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex items-center justify-between gap-4 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-sm">
      <span className="text-amber-800 font-medium">
        🔍 You're exploring a live demo with sample data — nothing you do here is saved.
      </span>
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={exitTour}
          className="rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 transition-colors"
        >
          Exit tour
        </button>
      </div>
    </div>
  );
}
