import { ConsoleThemeProvider } from '../contexts/ConsoleThemeContext';
import '../almc-theme.css';

/** Applies Airaplay console design tokens (standalone ALMC + embedded /console). */
export function ConsoleAppShell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <ConsoleThemeProvider>
      <div className="almc-app min-h-screen bg-background text-foreground font-['Inter',sans-serif]">
        {children}
      </div>
    </ConsoleThemeProvider>
  );
}
