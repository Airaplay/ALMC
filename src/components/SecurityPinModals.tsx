import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, ShieldCheck, Lock } from 'lucide-react';
import { changeSecurityPinRpc, setSecurityPinRpc } from '../lib/supabase';

/** Above full-screen flows (≈100–120) and confirm dialogs (70). */
const SECURITY_PIN_Z = 360;

/** Must match database `set_security_pin` validation. */
export const SECURITY_PIN_LENGTH = 6;

const inputCls =
  'w-full min-h-[52px] bg-white/[0.06] border border-white/[0.1] rounded-2xl px-4 py-3.5 text-white text-center text-lg tracking-[0.3em] font-black font-["Inter",sans-serif] outline-none transition-[border-color,box-shadow,background-color] duration-200 ' +
  'placeholder:text-white/20 focus:border-[#00ad74]/45 focus:bg-white/[0.08] focus:ring-2 focus:ring-[#00ad74]/15 disabled:opacity-45';

function PinLengthDots({ length, max = SECURITY_PIN_LENGTH }: { length: number; max?: number }): JSX.Element {
  return (
    <div className="flex justify-center gap-2 py-3" aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full transition-all duration-200 ${
            i < length ? 'bg-[#00ad74] shadow-[0_0_10px_rgba(0,173,116,0.35)]' : 'bg-white/[0.12]'
          }`}
        />
      ))}
    </div>
  );
}

type ShellProps = {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  titleId: string;
  descId: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
  icon: 'shield' | 'lock';
};

function SecurityPinShell({
  open,
  onClose,
  busy,
  titleId,
  descId,
  eyebrow,
  title,
  children,
  icon,
}: ShellProps): JSX.Element | null {
  const closeIfAllowed = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-5 sm:p-8"
      style={{
        zIndex: SECURITY_PIN_Z,
        paddingTop: 'max(1.25rem, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom, 0px))',
      }}
      role="presentation"
    >
      {/* Backdrop: dim + blur; tap dismisses when not busy */}
      <div
        role="presentation"
        className={`absolute inset-0 bg-[#0a0a0a]/80 backdrop-blur-md animate-fadeIn ${busy ? 'pointer-events-none' : 'cursor-pointer'}`}
        onClick={closeIfAllowed}
      />

      {/* Panel: centered, never hugging the notch-only edge */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative w-full max-w-[min(100%,22rem)] max-h-[min(90dvh,640px)] overflow-y-auto rounded-[1.75rem] border border-white/[0.09] bg-gradient-to-b from-[#1a1a1a] to-[#0c0c0c] shadow-[0_24px_80px_rgba(0,0,0,0.72),0_0_0_1px_rgba(255,255,255,0.04)_inset] animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute top-0 left-1/2 h-px w-24 -translate-x-1/2 rounded-full bg-gradient-to-r from-transparent via-[#00ad74]/50 to-transparent" />

        <div className="p-6 sm:p-7">
          <div className="flex items-start gap-4">
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
                icon === 'shield' ? 'bg-[#00ad74]/12' : 'bg-[#00ad74]/10'
              }`}
            >
              {icon === 'shield' ? (
                <ShieldCheck className="h-7 w-7 text-[#00ad74]" aria-hidden strokeWidth={1.75} />
              ) : (
                <Lock className="h-6 w-6 text-[#00ad74]" aria-hidden strokeWidth={1.75} />
              )}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#00ad74]/75">{eyebrow}</p>
              <h2 id={titleId} className="mt-1.5 font-['Inter',sans-serif] text-xl font-black tracking-tight text-white">
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={closeIfAllowed}
              disabled={busy}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/55 transition-colors hover:bg-white/[0.1] hover:text-white/80 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <div className="mt-5 space-y-5">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}

interface EnterSecurityPinModalProps {
  open: boolean;
  onClose: () => void;
  onSubmitPin: (pin: string) => Promise<void>;
  title?: string;
}

export const EnterSecurityPinModal = ({
  open,
  onClose,
  onSubmitPin,
  title = 'Confirm with PIN',
}: EnterSecurityPinModalProps): JSX.Element | null => {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setPin('');
      setLocalErr(null);
      setBusy(false);
      return;
    }
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  const submit = async () => {
    const p = pin.trim();
    if (p.length !== SECURITY_PIN_LENGTH || !/^\d+$/.test(p)) {
      setLocalErr(`Enter all ${SECURITY_PIN_LENGTH} digits.`);
      return;
    }
    setBusy(true);
    setLocalErr(null);
    try {
      await onSubmitPin(p);
      setPin('');
      onClose();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SecurityPinShell
      open={open}
      onClose={onClose}
      busy={busy}
      titleId="security-pin-enter-title"
      descId="security-pin-enter-hint"
      eyebrow="Security PIN"
      title={title}
      icon="shield"
    >
      <p id="security-pin-enter-hint" className="text-sm leading-relaxed text-white/55">
        {`Enter your ${SECURITY_PIN_LENGTH}-digit PIN. Same PIN for tips and withdrawals. Never share it.`}
      </p>

      <div>
        <label htmlFor="security-pin-enter-input" className="sr-only">
          {`Security PIN, ${SECURITY_PIN_LENGTH} digits`}
        </label>
        <input
          ref={inputRef}
          id="security-pin-enter-input"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={SECURITY_PIN_LENGTH}
          value={pin}
          aria-invalid={!!localErr}
          aria-describedby={
            localErr ? 'security-pin-enter-hint security-pin-enter-err' : 'security-pin-enter-hint'
          }
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, '').slice(0, SECURITY_PIN_LENGTH));
            setLocalErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pin.length === SECURITY_PIN_LENGTH && !busy) void submit();
          }}
          placeholder={'• '.repeat(SECURITY_PIN_LENGTH).trim()}
          className={inputCls}
          disabled={busy}
        />
        <PinLengthDots length={pin.length} />
      </div>

      {localErr && (
        <p id="security-pin-enter-err" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-center text-xs font-medium leading-snug text-red-300" role="alert">
          {localErr}
        </p>
      )}

      <div className="flex flex-col gap-3 pt-1">
        <button
          type="button"
          disabled={busy || pin.length !== SECURITY_PIN_LENGTH}
          onClick={() => void submit()}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-white font-['Inter',sans-serif] text-sm font-black text-black transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin text-black/70" /> : null}
          Continue
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => !busy && onClose()}
          className="py-2 text-center text-sm font-semibold text-white/40 transition-colors hover:text-white/60 active:text-white/50"
        >
          Cancel
        </button>
      </div>
    </SecurityPinShell>
  );
};

interface SetSecurityPinModalProps {
  open: boolean;
  onClose: () => void;
  onPinCreated: (pin: string) => Promise<void>;
}

export const SetSecurityPinModal = ({
  open,
  onClose,
  onPinCreated,
}: SetSecurityPinModalProps): JSX.Element | null => {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const pinARef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setA('');
      setB('');
      setLocalErr(null);
      setBusy(false);
      return;
    }
    const t = requestAnimationFrame(() => pinARef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  const submit = async () => {
    if (a !== b) {
      setLocalErr('Both entries must match.');
      return;
    }
    if (a.length !== SECURITY_PIN_LENGTH || !/^\d+$/.test(a)) {
      setLocalErr(`PIN must be exactly ${SECURITY_PIN_LENGTH} digits.`);
      return;
    }
    setBusy(true);
    setLocalErr(null);
    try {
      await setSecurityPinRpc(a, b);
      await onPinCreated(a);
      setA('');
      setB('');
      onClose();
    } catch (e) {
      setLocalErr(
        e instanceof Error ? e.message : typeof e === 'string' ? e : 'Could not save Security PIN'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SecurityPinShell
      open={open}
      onClose={onClose}
      busy={busy}
      titleId="security-pin-set-title"
      descId="security-pin-set-hint"
      eyebrow="One-time setup"
      title="Create your Security PIN"
      icon="lock"
    >
      <p id="security-pin-set-hint" className="text-sm leading-relaxed text-white/55">
        {`Use exactly ${SECURITY_PIN_LENGTH} digits. You will enter this PIN to send tips, move treats to Live Balance, and withdraw earnings.`}
      </p>

      <div className="space-y-4">
        <div>
          <label htmlFor="security-pin-set-a" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
            New PIN
          </label>
          <input
            ref={pinARef}
            id="security-pin-set-a"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={SECURITY_PIN_LENGTH}
            value={a}
            aria-invalid={!!localErr}
            aria-describedby={
              localErr ? 'security-pin-set-hint security-pin-set-err' : 'security-pin-set-hint'
            }
            onChange={(e) => {
              setA(e.target.value.replace(/\D/g, '').slice(0, SECURITY_PIN_LENGTH));
              setLocalErr(null);
            }}
            className={`${inputCls} tracking-[0.22em]`}
            disabled={busy}
          />
          <PinLengthDots length={a.length} />
        </div>
        <div>
          <label htmlFor="security-pin-set-b" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
            Confirm PIN
          </label>
          <input
            id="security-pin-set-b"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={SECURITY_PIN_LENGTH}
            value={b}
            aria-describedby={
              localErr ? 'security-pin-set-hint security-pin-set-err' : 'security-pin-set-hint'
            }
            onChange={(e) => {
              setB(e.target.value.replace(/\D/g, '').slice(0, SECURITY_PIN_LENGTH));
              setLocalErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && a.length === SECURITY_PIN_LENGTH && b.length === SECURITY_PIN_LENGTH && !busy) {
                void submit();
              }
            }}
            className={inputCls}
            disabled={busy}
          />
          <PinLengthDots length={b.length} />
        </div>
      </div>

      {localErr && (
        <p id="security-pin-set-err" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-center text-xs font-medium leading-snug text-red-300" role="alert">
          {localErr}
        </p>
      )}

      <div className="flex flex-col gap-3 pt-1">
        <button
          type="button"
          disabled={busy || a.length !== SECURITY_PIN_LENGTH || b.length !== SECURITY_PIN_LENGTH}
          onClick={() => void submit()}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-white font-['Inter',sans-serif] text-sm font-black text-black transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin text-black/70" /> : null}
          Save and continue
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => !busy && onClose()}
          className="py-2 text-center text-sm font-semibold text-white/40 transition-colors hover:text-white/60"
        >
          Cancel
        </button>
      </div>
    </SecurityPinShell>
  );
};

interface ChangeSecurityPinModalProps {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
}

export const ChangeSecurityPinModal = ({
  open,
  onClose,
  onChanged,
}: ChangeSecurityPinModalProps): JSX.Element | null => {
  const [current, setCurrent] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const currentRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setCurrent('');
      setA('');
      setB('');
      setLocalErr(null);
      setBusy(false);
      return;
    }
    const t = requestAnimationFrame(() => currentRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  const submit = async () => {
    if (a !== b) {
      setLocalErr('New PIN entries must match.');
      return;
    }
    if (current.length !== SECURITY_PIN_LENGTH || !/^\d+$/.test(current)) {
      setLocalErr(`Enter your current ${SECURITY_PIN_LENGTH}-digit PIN.`);
      return;
    }
    if (a.length !== SECURITY_PIN_LENGTH || !/^\d+$/.test(a)) {
      setLocalErr(`New PIN must be exactly ${SECURITY_PIN_LENGTH} digits.`);
      return;
    }
    if (current === a) {
      setLocalErr('New PIN must be different from your current PIN.');
      return;
    }
    setBusy(true);
    setLocalErr(null);
    try {
      await changeSecurityPinRpc(current, a, b);
      await onChanged?.();
      setCurrent('');
      setA('');
      setB('');
      onClose();
    } catch (e) {
      setLocalErr(
        e instanceof Error ? e.message : typeof e === 'string' ? e : 'Could not update Security PIN'
      );
    } finally {
      setBusy(false);
    }
  };

  const ready =
    current.length === SECURITY_PIN_LENGTH &&
    a.length === SECURITY_PIN_LENGTH &&
    b.length === SECURITY_PIN_LENGTH &&
    !busy;

  return (
    <SecurityPinShell
      open={open}
      onClose={onClose}
      busy={busy}
      titleId="security-pin-change-title"
      descId="security-pin-change-hint"
      eyebrow="Security PIN"
      title="Change your Security PIN"
      icon="shield"
    >
      <p id="security-pin-change-hint" className="text-sm leading-relaxed text-white/55">
        {`Enter your current PIN, then choose a new ${SECURITY_PIN_LENGTH}-digit PIN. Same rules as before: tips, treats, and withdrawals.`}
      </p>

      <div className="space-y-4">
        <div>
          <label htmlFor="security-pin-change-current" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
            Current PIN
          </label>
          <input
            ref={currentRef}
            id="security-pin-change-current"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={SECURITY_PIN_LENGTH}
            value={current}
            aria-invalid={!!localErr}
            aria-describedby={
              localErr ? 'security-pin-change-hint security-pin-change-err' : 'security-pin-change-hint'
            }
            onChange={(e) => {
              setCurrent(e.target.value.replace(/\D/g, '').slice(0, SECURITY_PIN_LENGTH));
              setLocalErr(null);
            }}
            className={inputCls}
            disabled={busy}
          />
          <PinLengthDots length={current.length} />
        </div>
        <div>
          <label htmlFor="security-pin-change-a" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
            New PIN
          </label>
          <input
            id="security-pin-change-a"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={SECURITY_PIN_LENGTH}
            value={a}
            aria-describedby={
              localErr ? 'security-pin-change-hint security-pin-change-err' : 'security-pin-change-hint'
            }
            onChange={(e) => {
              setA(e.target.value.replace(/\D/g, '').slice(0, SECURITY_PIN_LENGTH));
              setLocalErr(null);
            }}
            className={`${inputCls} tracking-[0.22em]`}
            disabled={busy}
          />
          <PinLengthDots length={a.length} />
        </div>
        <div>
          <label htmlFor="security-pin-change-b" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
            Confirm new PIN
          </label>
          <input
            id="security-pin-change-b"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={SECURITY_PIN_LENGTH}
            value={b}
            aria-describedby={
              localErr ? 'security-pin-change-hint security-pin-change-err' : 'security-pin-change-hint'
            }
            onChange={(e) => {
              setB(e.target.value.replace(/\D/g, '').slice(0, SECURITY_PIN_LENGTH));
              setLocalErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && ready) void submit();
            }}
            className={inputCls}
            disabled={busy}
          />
          <PinLengthDots length={b.length} />
        </div>
      </div>

      {localErr && (
        <p id="security-pin-change-err" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-center text-xs font-medium leading-snug text-red-300" role="alert">
          {localErr}
        </p>
      )}

      <div className="flex flex-col gap-3 pt-1">
        <button
          type="button"
          disabled={!ready}
          onClick={() => void submit()}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-white font-['Inter',sans-serif] text-sm font-black text-black transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin text-black/70" /> : null}
          Update PIN
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => !busy && onClose()}
          className="py-2 text-center text-sm font-semibold text-white/40 transition-colors hover:text-white/60"
        >
          Cancel
        </button>
      </div>
    </SecurityPinShell>
  );
};
