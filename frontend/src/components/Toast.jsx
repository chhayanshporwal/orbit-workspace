import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export function showToast(type, message) {
  window.dispatchEvent(new CustomEvent('orbit-toast', { detail: { type, message } }));
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handleToast = (e) => {
      if (!e.detail || !e.detail.message) return;
      const { type = 'info', message } = e.detail;
      const id = Math.random().toString(36).substring(2, 9);
      
      setToasts((prev) => [...prev, { id, type, message }]);

      // Auto-remove after 4 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    };

    window.addEventListener('orbit-toast', handleToast);
    return () => window.removeEventListener('orbit-toast', handleToast);
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => {
        const isError = t.type === 'error';
        const isSuccess = t.type === 'success';

        return (
          <div
            key={t.id}
            className={`pointer-events-auto w-full bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border rounded-2xl p-4 shadow-xl flex items-start gap-3 border-gray-100 dark:border-slate-800 transition-all duration-300 translate-y-0 animate-fadeIn`}
            role="alert"
          >
            <div className="shrink-0 mt-0.5">
              {isError && <AlertCircle className="text-red-500" size={18} />}
              {isSuccess && <CheckCircle2 className="text-green-500" size={18} />}
              {!isError && !isSuccess && <AlertCircle className="text-fuchsia-500" size={18} />}
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-gray-900 dark:text-white capitalize">
                {isError ? 'Error occurred' : isSuccess ? 'Success' : 'Notice'}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 leading-relaxed break-words font-medium">
                {t.message}
              </p>
            </div>

            <button
              onClick={() => setToasts((prev) => prev.filter((toast) => toast.id !== t.id))}
              className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors p-0.5 rounded-full hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
