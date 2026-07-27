import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useConsoleTheme, ConsoleThemePreference } from '../contexts/ConsoleThemeContext';
import { consoleTheme } from '../consoleTheme';

const OPTIONS: Array<{ value: ConsoleThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ConsoleThemeToggle({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}): JSX.Element {
  const { preference, setPreference, cyclePreference, resolved } = useConsoleTheme();

  if (compact) {
    const Icon = resolved === 'dark' ? Moon : Sun;
    return (
      <button
        type="button"
        onClick={cyclePreference}
        title={`Theme: ${preference} (click to change)`}
        aria-label={`Theme ${preference}. Click to change.`}
        className={cn(
          'rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground',
          className
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <div className={cn('inline-flex rounded-full border border-border/80 bg-card p-1', className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setPreference(value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
            preference === value
              ? consoleTheme.activeNav
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          {label}
        </button>
      ))}
    </div>
  );
}
