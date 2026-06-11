import React, { useState } from 'react';

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
  const isPassword = inputProps.type === 'password';
  const [showPassword, setShowPassword] = useState(false);

  const resolvedType = isPassword && showPassword ? 'text' : inputProps.type;

  return (
    <div className="space-y-1">
      <Label htmlFor={name} required={required}>
        {label}
      </Label>
      <div className={isPassword ? 'relative' : undefined}>
        <Input
          id={name}
          name={name}
          error={error}
          required={required}
          {...inputProps}
          type={resolvedType}
          className={isPassword ? 'pr-10' : undefined}
        />
        {isPassword && (
          <button
            type="button"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
            tabIndex={-1}
          >
            {showPassword ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 0 0-1.06 1.06l14.5 14.5a.75.75 0 1 0 1.06-1.06l-1.745-1.745a10.029 10.029 0 0 0 3.3-4.38 1.651 1.651 0 0 0 0-1.185A10.004 10.004 0 0 0 9.999 3a9.956 9.956 0 0 0-4.744 1.194L3.28 2.22ZM7.752 6.69l1.092 1.092a2.5 2.5 0 0 1 3.374 3.373l1.091 1.092a4 4 0 0 0-5.557-5.557Z" clipRule="evenodd" />
                <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 0 1-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 0 1 0-1.186A10.007 10.007 0 0 1 2.839 6.02L6.07 9.252a4 4 0 0 0 4.678 4.678Z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41Z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        )}
      </div>
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
