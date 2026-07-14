import React from 'react';
import { useNavigate } from 'react-router-dom';

interface State {
  hasError: boolean;
  error?: Error;
}

export class VideoPlayerErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('VideoPlayer screen error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center p-4">
          <p className="text-white text-lg font-medium mb-2">Something went wrong</p>
          <p className="text-white/70 text-sm mb-4 max-w-sm text-center">
            {this.state.error?.message || 'The video screen encountered an error.'}
          </p>
          <GoBackButton />
        </div>
      );
    }
    return this.props.children;
  }
}

function GoBackButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
      className="px-6 py-3 bg-[#309605] hover:bg-[#3ba208] rounded-xl font-medium text-white"
    >
      Go Back
    </button>
  );
}
