import React from 'react';

interface Props {
  children: React.ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ScreenErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Screen error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white items-center justify-center p-6">
          <p className="text-white text-lg font-medium mb-2">Something went wrong</p>
          <p className="text-white/70 text-sm mb-6 max-w-sm text-center">
            {this.props.fallbackMessage ?? this.state.error?.message ?? 'This screen encountered an error.'}
          </p>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="px-6 py-3 bg-[#309605] hover:bg-[#3ba208] rounded-xl font-medium text-white"
          >
            Go Back
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
