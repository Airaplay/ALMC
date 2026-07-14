import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface FloatingInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  rightSlot?: React.ReactNode;
}

export const ConsoleFloatingInput = React.forwardRef<HTMLInputElement, FloatingInputProps>(
  ({ label, rightSlot, className, onFocus, onBlur, onChange, ...props }, ref) => {
    const [focused, setFocused] = useState(false);
    const hasValue = !!props.value;
    const lifted = focused || hasValue;

    return (
      <div className="relative group">
        <label
          className={cn(
            'pointer-events-none absolute left-0 select-none font-["Inter",sans-serif] transition-all duration-200',
            lifted
              ? 'top-0 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#3ba208]'
              : 'top-[17px] text-sm text-white/50'
          )}
        >
          {label}
        </label>
        <input
          ref={ref}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          onChange={onChange}
          className={cn(
            'w-full border-0 border-b bg-transparent pb-2 pt-6 text-sm font-["Inter",sans-serif] text-white outline-none transition-colors duration-200 placeholder-white/30',
            focused ? 'border-[#3ba208]' : 'border-white/20',
            rightSlot ? 'pr-8' : '',
            className
          )}
          {...props}
        />
        {rightSlot ? <div className="absolute right-0 top-5 text-white/50">{rightSlot}</div> : null}
      </div>
    );
  }
);
ConsoleFloatingInput.displayName = 'ConsoleFloatingInput';

export function ConsolePrimaryButton({
  children,
  className,
  loading,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#3ba208] text-[13px] font-bold tracking-wide text-white transition-all hover:bg-[#3ba208]/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40',
        className
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}

export function ConsolePasswordToggle({
  show,
  onToggle,
}: {
  show: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button type="button" onClick={onToggle} className="text-white/50 hover:text-white/80">
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

export function ConsoleErrorAlert({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 p-3.5">
      <div className="mt-0.5 h-full w-1 shrink-0 rounded-full bg-red-400" />
      <p className="text-[12px] leading-relaxed text-red-400">{message}</p>
    </div>
  );
}

export function ConsoleSubmitArrow({ label }: { label: string }): JSX.Element {
  return (
    <>
      <span>{label}</span>
      <ArrowRight className="h-4 w-4" />
    </>
  );
}
