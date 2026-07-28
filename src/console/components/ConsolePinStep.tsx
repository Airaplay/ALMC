import { useState } from 'react';
import { Shield } from 'lucide-react';
import { ConsoleErrorAlert } from './ConsoleFormControls';
import { toSecurityPinErrorMessage } from '../lib/almcPinGate';

export type ConsolePinStepMode = 'verify' | 'setup';

type ConsolePinStepProps = {
  mode: ConsolePinStepMode;
  email?: string | null;
  isSubmitting?: boolean;
  onSubmitVerify: (pin: string) => Promise<void>;
  onSubmitSetup: (pin: string, confirmPin: string) => Promise<void>;
};

const glassLabel = 'mb-2 block text-sm font-medium text-white/85';
const glassInput =
  'w-full rounded-md bg-white px-4 py-3.5 text-[15px] text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:ring-2 focus:ring-[#33AA2D]/40 text-center tracking-[0.35em]';
const glassBtn =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#33AA2D] text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#2d9628] disabled:cursor-not-allowed disabled:opacity-70';

function PinField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className={glassLabel} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete={id.includes('confirm') ? 'new-password' : 'one-time-code'}
        maxLength={6}
        value={value}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, '').slice(0, 6);
          onChange(next);
        }}
        className={glassInput}
        placeholder={placeholder}
      />
    </div>
  );
}

export function ConsolePinStep({
  mode,
  email,
  isSubmitting = false,
  onSubmitVerify,
  onSubmitSetup,
}: ConsolePinStepProps): JSX.Element {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loading = isSubmitting || busy;
  const canSubmit =
    mode === 'verify'
      ? pin.length >= 4 && !loading
      : pin.length >= 4 && confirmPin.length >= 4 && pin === confirmPin && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      if (mode === 'verify') {
        await onSubmitVerify(pin);
      } else {
        await onSubmitSetup(pin, confirmPin);
      }
    } catch (err) {
      setError(toSecurityPinErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-start gap-3 rounded-lg border border-white/20 bg-white/10 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#33AA2D]/20">
          <Shield className="h-5 w-5 text-[#33AA2D]" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 text-[13px] leading-relaxed text-white/85">
          {mode === 'verify' ? (
            <p>
              Enter your security PIN to open the console
              {email ? (
                <>
                  {' '}
                  for <span className="font-medium text-white">{email}</span>
                </>
              ) : null}
              .
            </p>
          ) : (
            <p>
              Create a 4–6 digit security PIN. You will need it every time you sign in to the
              console{email ? <> as <span className="font-medium text-white">{email}</span></> : null}.
            </p>
          )}
        </div>
      </div>

      {error ? <ConsoleErrorAlert message={error} /> : null}

      <PinField
        id="almc-pin"
        label={mode === 'verify' ? 'Security PIN' : 'New PIN'}
        value={pin}
        onChange={(value) => {
          setPin(value);
          setError(null);
        }}
        placeholder="••••••"
      />

      {mode === 'setup' ? (
        <PinField
          id="almc-pin-confirm"
          label="Confirm PIN"
          value={confirmPin}
          onChange={(value) => {
            setConfirmPin(value);
            setError(null);
          }}
          placeholder="••••••"
        />
      ) : null}

      <button type="submit" disabled={!canSubmit} className={glassBtn}>
        {loading ? 'Verifying…' : mode === 'verify' ? 'Unlock console' : 'Save PIN & continue'}
      </button>
    </form>
  );
}
