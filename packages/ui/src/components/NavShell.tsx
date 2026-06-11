import React, { useState } from 'react';

interface NavItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
  active?: boolean;
}

interface NavShellProps {
  navItems: NavItem[];
  userEmail?: string;
  appName?: string;
  children: React.ReactNode;
  onSignOut?: () => void;
}

export function NavShell({ navItems, userEmail, appName = 'PFM', children, onSignOut }: NavShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex md:flex-col md:w-64 bg-white border-r border-gray-200">
        <SidebarContent
          navItems={navItems}
          userEmail={userEmail}
          appName={appName}
          onSignOut={onSignOut}
        />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="fixed inset-0 bg-gray-600 bg-opacity-50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative flex flex-col w-64 bg-white shadow-xl">
            <SidebarContent
              navItems={navItems}
              userEmail={userEmail}
              appName={appName}
              onSignOut={onSignOut}
            />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center h-14 px-4 bg-white border-b border-gray-200">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"
            aria-label="Open navigation"
          >
            <MenuIcon />
          </button>
          <span className="ml-3 font-semibold text-gray-900">{appName}</span>
        </header>

        <main className="flex-1 overflow-auto p-6" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({ navItems, userEmail, appName, onSignOut }: Omit<NavShellProps, 'children'>) {
  return (
    <>
      {/* Logo */}
      <div className="flex items-center h-16 px-6 border-b border-gray-200 flex-shrink-0">
        <span className="text-xl font-bold text-blue-600">{appName}</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Main navigation">
        {navItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={`
              flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
              ${item.active
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}
            `}
            aria-current={item.active ? 'page' : undefined}
          >
            {item.icon && <span className="flex-shrink-0 w-5 h-5">{item.icon}</span>}
            {item.label}
          </a>
        ))}
      </nav>

      {/* User footer — always shown when onSignOut is provided */}
      {onSignOut && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-gray-200">
          {userEmail && (
            <p className="text-xs text-gray-500 truncate mb-1">{userEmail}</p>
          )}
          <button
            onClick={onSignOut}
            className="text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </>
  );
}

function MenuIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
