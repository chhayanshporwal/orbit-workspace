import React from 'react';
import { ShieldCheck, Monitor } from 'lucide-react';

export default function RememberMeDialog({ isOpen, onSave, onDismiss }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Dark overlay backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-300"
        onClick={onDismiss}
      />

      {/* Dialog Card - Instagram style glassmorphism */}
      <div className="relative w-full max-w-sm bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-white/20 dark:border-gray-800/30 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 transform scale-100 flex flex-col p-6 items-center text-center">
        
        {/* Device Icon Circle */}
        <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center mb-4 border border-blue-100/50 dark:border-blue-800/30">
          <Monitor className="text-blue-600 dark:text-blue-400" size={32} />
        </div>

        {/* Header */}
        <h3 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white mb-2">
          Save Login Info?
        </h3>

        {/* Description */}
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 px-2 leading-relaxed">
          We can remember this device for you so you won't need to enter your password next time you log in.
        </p>

        {/* Buttons Stack */}
        <div className="w-full space-y-2">
          <button
            onClick={onSave}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all shadow-md shadow-blue-500/10 active:scale-[0.98]"
          >
            Save Info
          </button>
          
          <button
            onClick={onDismiss}
            className="w-full py-2.5 px-4 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium rounded-xl transition-all active:scale-[0.98]"
          >
            Not Now
          </button>
        </div>
      </div>
    </div>
  );
}
