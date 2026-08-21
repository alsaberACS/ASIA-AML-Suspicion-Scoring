import { FormEvent, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, LockKeyhole, ShieldAlert } from 'lucide-react';
import { grantAccess, verifyAccessCode } from '@/lib/access';

const EASE = [0.22, 1, 0.36, 1] as const;

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.45 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};

const FEATURES = [
  '17-RULE FORENSIC ENGINE',
  'CROSS-BANK PATTERNS',
  'SANCTIONS SCREENING',
  'GUARDED AI EVIDENCE',
];

export default function Landing({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'denied' | 'granted'>('idle');
  const [deniedCount, setDeniedCount] = useState(0);
  const reduceMotion = useReducedMotion();
  const unlockTimer = useRef<number | undefined>(undefined);

  // Defensive: never fire onUnlock after an unmount (HMR, external state changes).
  useEffect(() => () => window.clearTimeout(unlockTimer.current), []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (status === 'granted') return;
    if (verifyAccessCode(code)) {
      setStatus('granted');
      grantAccess();
      unlockTimer.current = window.setTimeout(onUnlock, reduceMotion ? 400 : 1150);
    } else {
      setStatus('denied');
      setDeniedCount((n) => n + 1);
    }
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-background text-foreground">
      {/* Surveillance-eye backdrop with slow drift */}
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center landing-zoom"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}brand/landing-eye.jpg)` }}
      />
      {/* Legibility + mood overlays */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-background/40 via-background/55 to-background/95" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-background/70 via-transparent to-background/90" />
      <div aria-hidden className="absolute inset-0 cyber-grid opacity-40" />
      {/* Sweeping scanline */}
      <div
        aria-hidden
        className="absolute left-0 right-0 h-px bg-primary/60 shadow-[0_0_12px_2px_hsl(var(--primary)/0.55)] landing-scan"
      />

      {/* Top bar */}
      <motion.header
        initial={reduceMotion ? false : { opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}
        className="relative z-10 flex items-center justify-between px-6 md:px-12 h-20"
      >
        <img
          src={import.meta.env.BASE_URL + 'brand/asia-logo-white.png'}
          alt="ASIA Data-Science"
          className="h-12 w-auto object-contain"
        />
        <div className="flex items-center gap-2 border border-destructive/40 bg-destructive/10 text-destructive px-3 py-1.5 rounded-sm">
          <ShieldAlert className="h-3.5 w-3.5" />
          <span className="font-mono text-[10px] uppercase tracking-[0.25em]">Restricted system</span>
        </div>
      </motion.header>

      {/* Content */}
      <div className="relative z-10 h-[calc(100%-5rem)] flex items-center">
        <div className="w-full max-w-[1600px] mx-auto px-6 md:px-12 grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
          {/* Left: the eye speaks for itself on large screens */}
          <div className="hidden lg:block" />

          {/* Right: pitch + access */}
          <motion.div
            variants={container}
            initial={reduceMotion ? false : 'hidden'}
            animate="show"
            className="max-w-xl lg:justify-self-end"
          >
            <motion.div variants={fadeUp} className="font-mono text-[11px] uppercase tracking-[0.35em] text-primary mb-5">
              ASIA Data-Science — Financial Crime Analytics
            </motion.div>

            <motion.h1 variants={fadeUp} className="text-4xl md:text-6xl font-bold leading-[1.05] tracking-tight">
              Every transaction
            </motion.h1>
            <motion.h1 variants={fadeUp} className="text-4xl md:text-6xl font-bold leading-[1.05] tracking-tight mb-6">
              leaves a{' '}
              <span className="text-primary drop-shadow-[0_0_18px_hsl(var(--primary)/0.45)]">trace.</span>
            </motion.h1>

            <motion.p variants={fadeUp} className="text-sm md:text-base text-muted-foreground leading-relaxed mb-6">
              The ASIA suspicion-scoring console fuses a deterministic forensic engine with guarded
              AI investigation — cross-bank patterns, sanctions screening, and an evidence pack your
              compliance team can defend.
            </motion.p>

            <motion.div variants={fadeUp} className="flex flex-wrap gap-2 mb-10">
              {FEATURES.map((f) => (
                <span
                  key={f}
                  className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border bg-card/60 backdrop-blur px-2 py-1 rounded-sm"
                >
                  {f}
                </span>
              ))}
            </motion.div>

            {/* Access gate */}
            <motion.div variants={fadeUp}>
              <motion.form
                onSubmit={handleSubmit}
                animate={status === 'denied' && !reduceMotion ? { x: [0, -10, 10, -6, 6, 0] } : { x: 0 }}
                transition={{ duration: 0.45 }}
                key={deniedCount}
                className={`cyber-panel backdrop-blur rounded-sm p-4 border transition-colors ${
                  status === 'denied'
                    ? 'border-destructive/60'
                    : status === 'granted'
                      ? 'border-emerald-500/60'
                      : 'border-primary/25'
                }`}
              >
                <label
                  htmlFor="access-code"
                  className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3"
                >
                  <LockKeyhole className="h-3.5 w-3.5 text-primary" />
                  Enter access code
                </label>
                <div className="flex gap-2">
                  <input
                    id="access-code"
                    type="password"
                    autoFocus
                    autoComplete="off"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      if (status === 'denied') setStatus('idle');
                    }}
                    placeholder="••••"
                    data-testid="input-access-code"
                    className="flex-1 bg-background/70 border border-border rounded-sm px-3 py-2.5 font-mono text-sm tracking-[0.4em] placeholder:tracking-[0.4em] focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
                  />
                  <button
                    type="submit"
                    data-testid="button-unlock"
                    disabled={status === 'granted'}
                    className="group flex items-center gap-2 bg-primary text-primary-foreground font-mono text-xs uppercase tracking-widest px-5 rounded-sm hover:bg-primary/90 transition-colors disabled:opacity-70"
                  >
                    Access
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </button>
                </div>

                <div className="h-5 mt-2.5" aria-live="polite">
                  {status === 'denied' && (
                    <span data-testid="text-access-error" className="font-mono text-[10px] uppercase tracking-widest text-destructive">
                      Access denied — incorrect code
                    </span>
                  )}
                  {status === 'granted' && (
                    <span data-testid="text-access-granted" className="font-mono text-[10px] uppercase tracking-widest text-emerald-500">
                      Access granted — initializing console
                    </span>
                  )}
                </div>
              </motion.form>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Footer */}
      <motion.footer
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 1.4 }}
        className="absolute bottom-0 left-0 right-0 z-10 h-10 flex items-center justify-between px-6 md:px-12 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70 border-t border-border/40 bg-background/40 backdrop-blur"
      >
        <span>ASIA Consulting and Private Training — Shayma Tower, Fl 10, Kuwait City</span>
        <span className="hidden md:inline">Authorized personnel only</span>
      </motion.footer>

      {/* Unlock transition: expanding iris ring (simple fade under reduced motion) */}
      {status === 'granted' &&
        (reduceMotion ? (
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35 }}
            className="absolute inset-0 z-20 bg-background"
          />
        ) : (
          <motion.div
            aria-hidden
            initial={{ scale: 0, opacity: 0.9 }}
            animate={{ scale: 34, opacity: 1 }}
            transition={{ duration: 1.05, ease: [0.65, 0, 0.35, 1] }}
            className="absolute z-20 left-1/2 top-1/2 -ml-12 -mt-12 h-24 w-24 rounded-full bg-background border-4 border-primary/60"
          />
        ))}
    </div>
  );
}
