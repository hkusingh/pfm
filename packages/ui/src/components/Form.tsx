import React from 'react';

// ─── Label ────────────────────────────────────────────────────────────────────

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export function Label({ children, required, className = '', ...props }: LabelProps) {
  return (
    <label className={`block text-sm font-medium text-gray-700 ${className}`} {...props}>
      {children}
      {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
    </label>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export function Input({ error, className = '', ...props }: InputProps) {
  return (
    <input
      className={`
        block w-full rounded-lg border px-3 py-2 text-sm text-gray-900
        placeholder:text-gray-400
        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
        disabled:bg-gray-50 disabled:text-gray-500
        ${error ? 'border-red-400 focus:ring-red-400' : 'border-gray-300'}
        ${className}
      `}
      aria-invalid={error ? 'true' : undefined}
      {...props}
    />
  );
}

// ─── FormField ────────────────────────────────────────────────────────────────
// Self-contained label + input field. Spreads all <input> HTML attributes.

interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  error?: string;
  hint?: string;
}

export function FormField({ label, name, error, hint, required, ...inputProps }: FormFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name} required={required}>
        {label}
      </Label>
      <Input id={name} name={name} error={error} required={required} {...inputProps} />
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
      {error && (
        <p className="text-xs text-red-600" role="alert" id={`${name}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

// ─── FormError ────────────────────────────────────────────────────────────────

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">
      {message}
    </div>
  );
}
