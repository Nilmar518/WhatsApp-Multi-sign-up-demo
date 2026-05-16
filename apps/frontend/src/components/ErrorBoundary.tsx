import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-surface-sidebar flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-surface-sidebar-hover rounded-xl p-6 ring-1 ring-white/10 flex flex-col gap-4">
            <p className="text-content-inv font-bold text-sm">Ocurrió un error inesperado</p>
            <pre className="text-danger-text text-xs bg-danger-bg/10 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="text-xs font-semibold text-brand hover:text-brand-hover transition-colors"
            >
              Recargar la página
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
