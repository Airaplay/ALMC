import { useEffect } from 'react';
import '../almc-theme.css';

/** Applies Airaplay console design tokens (standalone ALMC + embedded /console). */
export function ConsoleAppShell({ children }: { children: React.ReactNode }): JSX.Element {
  useEffect(() => {
    document.documentElement.classList.add('almc-app', 'dark');
    document.body.classList.add('almc-app');
    return () => {
      document.documentElement.classList.remove('almc-app', 'dark');
      document.body.classList.remove('almc-app');
    };
  }, []);

  return (
    <div className="almc-app min-h-screen bg-background text-foreground font-['Inter',sans-serif]">
      {children}
    </div>
  );
}
