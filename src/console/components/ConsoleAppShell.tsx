import { useEffect } from 'react';
import { BUILD_TARGET } from '../../lib/buildTarget';
import '../almc-theme.css';

/** Applies Airaplay web design tokens to ALMC (standalone + embedded /console routes). */
export function ConsoleAppShell({ children }: { children: React.ReactNode }): JSX.Element {
  useEffect(() => {
    if (BUILD_TARGET === 'web') {
      return;
    }
    document.documentElement.classList.add('almc-app');
    document.body.classList.add('almc-app');
    return () => {
      document.documentElement.classList.remove('almc-app');
      document.body.classList.remove('almc-app');
    };
  }, []);

  return (
    <div className="almc-app min-h-screen bg-background text-foreground font-['Inter',sans-serif]">
      {children}
    </div>
  );
}
