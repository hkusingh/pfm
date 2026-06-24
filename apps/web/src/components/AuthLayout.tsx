import type { ReactNode } from 'react';
import { APP_NAME } from '../lib/appName';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 overflow-hidden bg-slate-900">

      {/* Gradient orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-blue-600 opacity-20 blur-3xl" />
        <div className="absolute top-1/3 -right-32 w-80 h-80 rounded-full bg-indigo-500 opacity-20 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 w-72 h-72 rounded-full bg-violet-600 opacity-15 blur-3xl" />
      </div>

      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Decorative SVG circles top-right */}
      <svg
        className="absolute top-0 right-0 opacity-10 pointer-events-none"
        width="400"
        height="400"
        viewBox="0 0 400 400"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="350" cy="50" r="200" stroke="white" strokeWidth="1" fill="none" />
        <circle cx="350" cy="50" r="150" stroke="white" strokeWidth="1" fill="none" />
        <circle cx="350" cy="50" r="100" stroke="white" strokeWidth="1" fill="none" />
      </svg>

      {/* Decorative SVG circles bottom-left */}
      <svg
        className="absolute bottom-0 left-0 opacity-10 pointer-events-none"
        width="300"
        height="300"
        viewBox="0 0 300 300"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="50" cy="250" r="150" stroke="white" strokeWidth="1" fill="none" />
        <circle cx="50" cy="250" r="100" stroke="white" strokeWidth="1" fill="none" />
        <circle cx="50" cy="250" r="50" stroke="white" strokeWidth="1" fill="none" />
      </svg>

      {/* Branding above the card */}
      <div className="relative w-full max-w-md">
        <div className="text-center mb-6">
          <img
            src="/logo.svg"
            alt={`${APP_NAME} logo`}
            className="mx-auto mb-3 h-12 w-12"
            width={48}
            height={48}
          />
          <span className="text-2xl font-bold text-white tracking-tight">
            {APP_NAME}
          </span>
          <p className="mt-1 text-sm text-slate-400">Your household finances, together</p>
        </div>
        {children}
      </div>
    </div>
  );
}
