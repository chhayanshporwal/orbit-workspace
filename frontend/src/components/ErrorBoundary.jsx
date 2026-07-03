import React from 'react';
import { AlertOctagon, RefreshCw, Home } from 'lucide-react';
import PillButton from './PillButton';
import { api } from '../utils/api';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    // Log meaningful details to console for debugging
    console.error("🔴 Orbit Application Runtime Error:", error);
    console.error("🔴 Error Info Component Stack:", errorInfo?.componentStack);

    // Report crash to backend error logger
    api.post('/client-errors', {
      error: error.toString(),
      componentStack: errorInfo?.componentStack,
      url: window.location.href
    }).catch(err => console.error("Failed to log error to backend:", err));
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-white rounded-3xl border border-gray-100 shadow-2xl p-8 text-center flex flex-col items-center">
            
            {/* Warning Icon Badge */}
            <div className="w-16 h-16 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600 mb-6 shadow-sm border border-rose-100">
              <AlertOctagon size={32} />
            </div>

            {/* Error Message */}
            <h1 className="text-xl font-black text-gray-900 tracking-tight leading-tight">
              Oops! Something went wrong
            </h1>
            <p className="text-xs text-gray-500 mt-2.5 leading-relaxed">
              An unexpected rendering error occurred inside Orbit. The details have been logged to the browser developer console.
            </p>

            {/* Error Details Accordion */}
            {this.state.error && (
              <div className="w-full mt-6 bg-slate-50 rounded-xl border border-slate-100 p-3 text-left">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">
                  Error Details
                </div>
                <div className="text-[11px] font-mono text-rose-700 bg-rose-50/50 p-2 rounded-lg border border-rose-100/50 break-words max-h-24 overflow-y-auto">
                  {this.state.error.toString()}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="mt-8 flex gap-3 w-full">
              <button
                onClick={this.handleReload}
                className="flex-1 py-2.5 px-4 bg-fuchsia-600 hover:bg-fuchsia-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5"
              >
                <RefreshCw size={14} /> Retry View
              </button>
              <button
                onClick={this.handleGoHome}
                className="flex-1 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
              >
                <Home size={14} /> Go Home
              </button>
            </div>

          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
