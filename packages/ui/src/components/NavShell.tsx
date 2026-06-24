import React, { useState } from 'react';

export interface NavItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
  active?: boolean;
  badge?: number;
}

interface NavShellProps {
  navItems: NavItem[];
  userEmail?: string;
  userInitial?: string;
  appName?: string;
  logoSrc?: string;
  householdName?: string;
  memberCount?: number;
  children: React.ReactNode;
  onSignOut?: () => void;
  onNavigate?: (href: string) => void;
}

export function NavShell({ navItems, userEmail, userInitial, appName = 'Smart Munshi', logoSrc, householdName, memberCount, children, onSignOut, onNavigate }: NavShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const initial = userInitial ?? (userEmail ? userEmail[0].toUpperCase() : '?');

  return (
    <div className="min-h-screen flex" style={{ background: '#eef1f6' }}>
      {/* Sidebar — desktop (sticky viewport-height so footer stays pinned) */}
      <aside className="hidden md:flex md:flex-col md:w-64 flex-shrink-0 sticky top-0 h-screen" style={{ background: '#142d44' }}>
        <SidebarContent navItems={navItems} userEmail={userEmail} userInitial={initial} appName={appName} logoSrc={logoSrc} householdName={householdName} memberCount={memberCount} onSignOut={onSignOut} onNavigate={onNavigate} />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="fixed inset-0"
            style={{ background: 'rgba(0,0,0,0.5)' }}
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative flex flex-col w-64 shadow-xl" style={{ background: '#142d44' }}>
            <SidebarContent navItems={navItems} userEmail={userEmail} userInitial={initial} appName={appName} logoSrc={logoSrc} householdName={householdName} memberCount={memberCount} onSignOut={onSignOut} onNavigate={onNavigate} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile-only thin top bar */}
        <div className="md:hidden flex items-center h-12 px-4" style={{ background: '#142d44' }}>
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5"
            style={{ color: '#cdd9e6' }}
            aria-label="Open navigation"
          >
            <MenuIcon />
          </button>
          {logoSrc
            ? <img src={logoSrc} alt={appName} className="ml-3" style={{ height: 32, width: 'auto' }} />
            : <span className="ml-3 text-white font-semibold text-sm">{appName}</span>}
        </div>

        <main className="flex-1 overflow-auto p-6" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}

interface SidebarContentProps {
  navItems: NavItem[];
  userEmail?: string;
  userInitial: string;
  appName: string;
  logoSrc?: string;
  householdName?: string;
  memberCount?: number;
  onSignOut?: () => void;
  onNavigate?: (href: string) => void;
}

function SidebarContent({ navItems, userEmail, userInitial, appName, logoSrc, householdName, memberCount, onSignOut, onNavigate }: SidebarContentProps) {
  return (
    <>
      {/* Brand */}
      <div className="flex items-center pt-[18px] pb-4 flex-shrink-0 justify-center">
        {logoSrc
          ? <img src={logoSrc} alt={appName} style={{ width: '100%', height: 'auto' }} />
          : (
            <>
              <div
                className="w-6 h-6 flex-shrink-0 mr-2"
                style={{ borderRadius: 7, background: 'linear-gradient(135deg,#2E6DA4,#2F855A)' }}
              />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>{appName}</span>
            </>
          )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto" aria-label="Main navigation">
        {navItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            onClick={onNavigate ? (e) => { e.preventDefault(); onNavigate(item.href); } : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 20px',
              fontSize: 14,
              textDecoration: 'none',
              color: item.active ? '#fff' : '#cdd9e6',
              borderLeft: `3px solid ${item.active ? '#2F855A' : 'transparent'}`,
              background: item.active ? 'rgba(255,255,255,0.08)' : 'transparent',
              transition: 'background 0.15s, color 0.15s',
            }}
            aria-current={item.active ? 'page' : undefined}
            onMouseEnter={(e) => {
              if (!item.active) {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
                (e.currentTarget as HTMLElement).style.color = '#fff';
              }
            }}
            onMouseLeave={(e) => {
              if (!item.active) {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
                (e.currentTarget as HTMLElement).style.color = '#cdd9e6';
              }
            }}
          >
            {/* Icon dot */}
            <span
              className="flex-shrink-0"
              style={{
                width: 16, height: 16, borderRadius: 4,
                background: item.active ? '#2F855A' : '#3a5670',
                display: 'inline-block',
              }}
            />
            <span className="flex-1">{item.label}</span>
            {item.badge != null && item.badge > 0 && (
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: '1.25rem', height: '1.25rem', padding: '0 6px',
                  borderRadius: 9999, background: '#ef4444', color: '#fff',
                  fontSize: 11, fontWeight: 600, lineHeight: 1,
                }}
              >
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </a>
        ))}
      </nav>

      {/* Household label + settings gear */}
      {(householdName != null || memberCount != null) && (
        <div
          className="flex-shrink-0 flex items-center justify-between px-5 py-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <span style={{ color: '#8aa0b6', fontSize: 11 }}>
            {householdName ?? ''}
            {memberCount != null && (
              <> &middot; {memberCount} {memberCount === 1 ? 'member' : 'members'}</>
            )}
          </span>
          <a
            href="/settings"
            aria-label="Settings"
            onClick={onNavigate ? (e) => { e.preventDefault(); onNavigate('/settings'); } : undefined}
            style={{ color: '#8aa0b6', textDecoration: 'none', lineHeight: 1 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#fff'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#8aa0b6'; }}
          >
            <GearIcon />
          </a>
        </div>
      )}

      {/* Footer */}
      <div
        className="flex-shrink-0 px-5 py-3.5"
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)', color: '#8aa0b6', fontSize: 12 }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: '#1F4E79', color: '#fff', fontSize: 12, fontWeight: 700,
            }}
          >
            {userInitial}
          </div>
          <div className="min-w-0 flex-1">
            {userEmail && <p className="truncate" style={{ color: '#8aa0b6', fontSize: 11, margin: 0 }}>{userEmail}</p>}
            {onSignOut && (
              <button
                onClick={onSignOut}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#8aa0b6', fontSize: 11 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#fff'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#8aa0b6'; }}
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      </div>
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

function GearIcon() {
  return (
    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
