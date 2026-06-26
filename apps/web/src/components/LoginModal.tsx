import { useEffect, useRef } from 'react';
import { LoginForm } from './LoginForm';
import { APP_NAME } from '../lib/appName';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
}

export function LoginModal({ open, onClose }: LoginModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Log in"
        className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl p-7"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3.5 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
        >
          ×
        </button>
        <h3 className="text-xl font-bold text-[#1B3242] mb-1">Welcome back</h3>
        <p className="text-sm text-gray-500 mb-5">Log in to your {APP_NAME} household</p>
        <LoginForm onSuccess={onClose} />
      </div>
    </div>
  );
}
