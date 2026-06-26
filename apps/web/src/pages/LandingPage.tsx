import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiException } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LoginModal } from '../components/LoginModal';
import { APP_NAME } from '../lib/appName';

const LOGO = '/thesm-logo-light.png';

// ── Design tokens ─────────────────────────────────────────────────────────────
const navy = '#1B3242';
const gold = '#C9A227';
const teal = '#2E6DA4';
const soft = '#F5F8FB';

// ── Small reusable bits ───────────────────────────────────────────────────────

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full"
      style={{ background: '#EAF2FA', color: teal }}>
      {children}
    </span>
  );
}

function Soon() {
  return (
    <span className="ml-1.5 inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ background: '#FFF3CD', color: '#7A5D00' }}>
      Coming soon
    </span>
  );
}

function BtnPrimary({ children, onClick, className = '' }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button onClick={onClick}
      className={`rounded-xl font-semibold px-6 py-3.5 text-base transition-opacity hover:opacity-90 ${className}`}
      style={{ background: gold, color: '#1a1400' }}>
      {children}
    </button>
  );
}

function BtnGhost({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className="rounded-xl font-semibold px-6 py-3.5 text-base border transition-colors hover:bg-gray-50"
      style={{ borderColor: '#e4ebf1', color: navy }}>
      {children}
    </button>
  );
}

function Lock() { return <span className="mr-2">🔒</span>; }

function ScreenShot({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className="w-full rounded-2xl shadow-xl border border-gray-200 object-cover object-top"
    />
  );
}

// ── Section: Benefit (alternating layout) ─────────────────────────────────────

function Benefit({ tag, heading, body, screenshot, flip = false }: { tag: React.ReactNode; heading: string; body: string; screenshot: string; flip?: boolean }) {
  return (
    <div className={`flex flex-col md:flex-row gap-10 items-center py-10 ${flip ? 'md:flex-row-reverse' : ''}`}>
      <div className="flex-1 space-y-3">
        <Tag>{tag}</Tag>
        <h3 className="text-2xl font-bold" style={{ color: navy }}>{heading}</h3>
        <p className="text-base leading-relaxed" style={{ color: '#5b7185' }}>{body}</p>
      </div>
      <div className="flex-1">
        <ScreenShot src={screenshot} alt={heading} />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function LandingPage() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [tourLoading, setTourLoading] = useState(false);
  const [tourError, setTourError] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const { setDemoToken, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (isAuthenticated) { navigate('/dashboard', { replace: true }); }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  async function startTour() {
    setTourLoading(true);
    setTourError('');
    try {
      const res = await api.post<{ accessToken: string }>('/auth/demo');
      setDemoToken(res.accessToken);
      navigate('/dashboard');
    } catch (err) {
      setTourError(err instanceof ApiException ? err.message : 'Demo unavailable. Try again shortly.');
      setTourLoading(false);
    }
  }

  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-white font-sans" style={{ color: navy }}>

      {/* ── Header ── */}
      <header ref={headerRef} className={`sticky top-0 z-30 transition-shadow ${scrolled ? 'shadow-sm' : ''}`}
        style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #e4ebf1' }}>
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between h-[80px]">
          <a href="#product"><img src={LOGO} alt={APP_NAME} className="h-[64px] w-auto" /></a>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#product" className="text-sm font-medium hover:text-gray-900" style={{ color: '#5b7185' }}>Product</a>
            <a href="#how" className="text-sm font-medium hover:text-gray-900" style={{ color: '#5b7185' }}>How it works</a>
            <a href="#security" className="text-sm font-medium hover:text-gray-900" style={{ color: '#5b7185' }}>Security</a>
            <a href="#usecases" className="text-sm font-medium hover:text-gray-900" style={{ color: '#5b7185' }}>Use cases</a>
            <button onClick={() => setLoginOpen(true)}
              className="rounded-xl font-semibold px-4 py-2 text-sm text-white transition-opacity hover:opacity-90"
              style={{ background: navy }}>
              Log in
            </button>
          </nav>
          {/* Mobile log in */}
          <button onClick={() => setLoginOpen(true)}
            className="md:hidden rounded-xl font-semibold px-4 py-2 text-sm text-white"
            style={{ background: navy }}>
            Log in
          </button>
        </div>
      </header>

      {/* ── Hero ── */}
      <section id="product" className="py-16 md:py-20" style={{ background: `linear-gradient(180deg, #ffffff, ${soft})` }}>
        <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
          <div>
            <Tag>AI insights · 360° view</Tag>
            <h1 className="text-4xl md:text-5xl font-bold leading-[1.08] mt-4 mb-3 tracking-tight">
              <span style={{ color: gold }}>Insights that keep your money ahead of life</span> — without the busywork.
            </h1>
            <p className="text-lg leading-relaxed mb-6" style={{ color: '#5b7185', maxWidth: 560 }}>
              {APP_NAME} brings every account into one 360° view and surfaces what's changing — so you act on insight, not data entry.
              Connect automatically<sup>*</sup> and let AI take care of the rest.
            </p>
            <div className="flex flex-wrap gap-3 mb-4">
              <BtnPrimary onClick={startTour}>
                {tourLoading ? 'Loading…' : 'Take the tour →'}
              </BtnPrimary>
              <BtnGhost onClick={() => setLoginOpen(true)}>Log in</BtnGhost>
            </div>
            {tourError && <p className="text-sm text-red-600 mb-2">{tourError}</p>}
            <p className="text-sm" style={{ color: '#5b7185' }}>
              🔒 <strong style={{ color: navy }}>App-level encryption</strong> · <strong style={{ color: navy }}>Mandatory MFA</strong> · <strong style={{ color: navy }}>Bank-level security</strong>
            </p>
            <p className="text-xs mt-2" style={{ color: '#9fb1c1' }}><sup>*</sup> Coming soon — feature in development; not available today.</p>
          </div>
          <ScreenShot src="/dashboard.png" alt="Smart Munshi dashboard showing 360° household finance view" />
        </div>
      </section>

      {/* ── Trust strip ── */}
      <div className="py-5" style={{ background: navy, color: '#dce6ef' }}>
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-center">
          {[
            ['AES-256-GCM', 'App-level field encryption'],
            ['Mandatory MFA', 'Every account, always'],
            ['Bank-grade*', 'Plaid-tokenized — no stored bank password'],
            ["You're in control", 'Your data, never sold'],
          ].map(([title, sub]) => (
            <div key={title}>
              <div className="font-bold text-white">{title}</div>
              <div className="text-xs mt-0.5" style={{ color: '#b9c8d6' }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Friction killer ── */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold" style={{ color: navy }}>Stop uploading statements and tagging transactions</h2>
          <p className="mt-3 text-base" style={{ color: '#5b7185' }}>Two things make money apps a chore — getting the data in, and sorting it out. We remove both.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl p-7 border" style={{ background: soft, borderColor: '#e4ebf1' }}>
            <div className="text-sm font-bold mb-2" style={{ color: teal }}>Automatic import <Soon /></div>
            <h4 className="text-lg font-bold mb-2" style={{ color: navy }}>Connect your accounts<sup>*</sup></h4>
            <p className="text-sm leading-relaxed" style={{ color: '#5b7185' }}>
              Securely link your banks once with Plaid and transactions flow in automatically — no more downloading and uploading statements.
              Prefer manual? Statement upload is available today.
            </p>
          </div>
          <div className="rounded-2xl p-7 border" style={{ background: soft, borderColor: '#e4ebf1' }}>
            <div className="text-sm font-bold mb-2" style={{ color: teal }}>AI categorization</div>
            <h4 className="text-lg font-bold mb-2" style={{ color: navy }}>Sorted for you</h4>
            <p className="text-sm leading-relaxed" style={{ color: '#5b7185' }}>
              Native AI<sup>*</sup> (plus optional bring-your-own-key) categorizes transactions and learns your corrections — no more tagging every line by hand.
            </p>
          </div>
        </div>
      </section>

      {/* ── Benefits ── */}
      <section id="benefits" className="max-w-5xl mx-auto px-6 pb-8">
        <div className="text-center mb-6">
          <h2 className="text-3xl font-bold" style={{ color: navy }}>Everything in one place — and ahead of you</h2>
          <p className="mt-3 text-base" style={{ color: '#5b7185' }}>A clear, shared picture of household finances, with AI assistance and budgeting that handles real life.</p>
        </div>
        <Benefit
          tag="360° View"
          heading="One shared view across the whole household"
          body="Every account in a single picture, with per-account visibility — shared, private, or balance-only — so each person keeps control of what others see."
          screenshot="/accounts.png"
        />
        <Benefit
          flip
          tag={<>AI · Native<sup>*</sup> + BYOK</>}
          heading="Automatic, AI-assisted categorization"
          body="Native AI* sorts your transactions and surfaces what's changing; bring your own key today for AI-assisted categorization. It learns your corrections — and only normalized merchant + amount is ever sent."
          screenshot="/transaction.png"
        />
        <Benefit
          tag="Budgeting"
          heading="Budgets that handle the big annual bills"
          body='Monthly budgets with sub-categories, plus amortized "sinking funds" that spread insurance, property tax, and travel across the year — no nasty surprises.'
          screenshot="/budgets.png"
        />
        <Benefit
          flip
          tag="Reports & insights"
          heading="See where every dollar went"
          body="Period-over-period charts, income vs expenses, and spending by category — so you always know where you stand, not just where you've been."
          screenshot="/reports.png"
        />
      </section>

      {/* ── How it works ── */}
      <section id="how" className="py-16" style={{ background: soft }}>
        <div className="max-w-5xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold mb-2" style={{ color: navy }}>How it works</h2>
          <p className="text-base mb-10" style={{ color: '#5b7185' }}>Three steps to a clearer financial picture.</p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { n: '1', title: 'Connect your accounts', body: 'Link banks automatically with Plaid*, or import statements today. Multi-currency supported.' },
              { n: '2', title: 'Organize & budget', body: 'Categorize, set monthly budgets and sinking funds, invite your partner with the right role.' },
              { n: '3', title: 'See insights & stay ahead', body: 'A 360° dashboard, AI-assisted categories, and period-over-period reports keep you ahead.' },
            ].map(({ n, title, body }) => (
              <div key={n} className="rounded-2xl p-7 bg-white border text-left" style={{ borderColor: '#e4ebf1' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white text-sm mb-4"
                  style={{ background: navy }}>{n}</div>
                <h4 className="font-bold text-base mb-2" style={{ color: navy }}>{title}</h4>
                <p className="text-sm leading-relaxed" style={{ color: '#5b7185' }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Use cases ── */}
      <section id="usecases" className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold" style={{ color: navy }}>Built for how households really work</h2>
          <p className="mt-3 text-base" style={{ color: '#5b7185' }}>From couples to multi-currency families.</p>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5">
          {[
            { who: 'Couples', title: 'Joint + separate money', body: 'Shared view for the household, private accounts for each person.' },
            { who: 'Families', title: 'Big annual expenses', body: 'Sinking funds smooth insurance, tuition, and property tax across the year.' },
            { who: 'Expats', title: 'Multi-currency', body: 'Hold accounts in USD, EUR, GBP, or INR — each in its own currency.' },
            { who: 'Busy people', title: 'Set it and forget it', body: 'Auto-sync with Plaid* and let AI categorize — your finances stay current with no effort.' },
          ].map(({ who, title, body }) => (
            <div key={who} className="rounded-2xl p-6 border" style={{ background: soft, borderColor: '#e4ebf1' }}>
              <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: teal }}>{who}</div>
              <h4 className="font-bold text-base mb-2" style={{ color: navy }}>{title}</h4>
              <p className="text-sm leading-relaxed" style={{ color: '#5b7185' }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Security ── */}
      <section id="security" className="py-16" style={{ background: soft }}>
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold" style={{ color: navy }}>Security & data handling</h2>
            <p className="mt-3 text-base" style={{ color: '#5b7185' }}>Built to protect sensitive financial data — and honest about how.</p>
          </div>
          <div className="max-w-2xl mx-auto space-y-3">
            {[
              'Sensitive fields encrypted at the application layer (AES-256-GCM).',
              'Encrypted in transit (TLS) and at rest.',
              'Mandatory multi-factor authentication on every account.',
              'Bank connections are tokenized via Plaid* — we never store your bank password.',
              'Per-account visibility; household data scoped per member.',
              'Bring-your-own-key AI — your key is never logged or returned.',
            ].map(line => (
              <div key={line} className="flex items-start gap-3 text-sm" style={{ color: navy }}>
                <Lock />{line}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Tour callout ── */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <div className="rounded-3xl p-12 text-center text-white"
          style={{ background: `linear-gradient(120deg, ${navy}, ${teal})` }}>
          <h2 className="text-3xl font-bold mb-3">See it with real-looking data — no account needed</h2>
          <p className="text-base mb-7" style={{ color: '#cfe0ef', maxWidth: 520, margin: '8px auto 28px' }}>
            Walk through the dashboard, accounts, budgets, and reports using a fully populated demo household.
          </p>
          <BtnPrimary onClick={startTour}>
            {tourLoading ? 'Loading…' : 'Start the tour →'}
          </BtnPrimary>
          {tourError && <p className="text-sm text-red-300 mt-3">{tourError}</p>}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-10 mt-6" style={{ background: navy, color: '#b9c8d6' }}>
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="text-xl font-extrabold text-white">
              The<span style={{ color: gold }}>Smart</span> Munshi
            </div>
            <p className="text-sm mt-3" style={{ maxWidth: 260, color: '#b9c8d6' }}>
              Smart household finance &amp; AI insights — a proactive, private 360° view of your money.
            </p>
          </div>
          <div>
            <h5 className="text-xs font-bold uppercase tracking-widest text-white mb-3">Product</h5>
            {[['#product', 'Overview'], ['#how', 'How it works'], ['#security', 'Security']].map(([href, label]) => (
              <a key={label} href={href} className="block text-sm py-1.5 hover:text-white transition-colors">{label}</a>
            ))}
          </div>
          <div>
            <h5 className="text-xs font-bold uppercase tracking-widest text-white mb-3">Company</h5>
            {[['#', 'About'], ['#', 'Privacy']].map(([href, label]) => (
              <a key={label} href={href} className="block text-sm py-1.5 hover:text-white transition-colors">{label}</a>
            ))}
          </div>
          <div>
            <h5 className="text-xs font-bold uppercase tracking-widest text-white mb-3">Get started</h5>
            <button onClick={() => setLoginOpen(true)} className="block text-sm py-1.5 hover:text-white transition-colors">Log in</button>
            <button onClick={startTour} className="block text-sm py-1.5 hover:text-white transition-colors">Take the tour</button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-6 mt-8 text-xs" style={{ color: '#8499aa' }}>
          <sup>*</sup> Coming soon — feature in development; not available today. &nbsp;·&nbsp; © {currentYear} {APP_NAME}. All rights reserved.
        </div>
      </footer>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
