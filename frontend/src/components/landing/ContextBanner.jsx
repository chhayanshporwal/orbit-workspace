import React from 'react';
import { motion } from 'framer-motion';

export default function ContextBanner() {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.3, duration: 0.6 }}
      className="max-w-4xl mx-auto px-6 mb-16 z-20 relative -mt-12"
    >
      <div className="p-[2px] rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 dark:from-indigo-500/30 dark:to-purple-500/10 transition-colors duration-300">
        <div className="px-6 py-4 rounded-xl bg-white/80 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200/50 dark:border-slate-800/50 flex flex-col sm:flex-row items-center justify-center gap-3 text-center sm:text-left transition-colors duration-300">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500/75 dark:bg-indigo-400/75 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-600 dark:bg-indigo-500"></span>
          </span>
          <p className="text-sm md:text-base text-slate-700 dark:text-slate-300 font-medium tracking-wide transition-colors duration-300">
            Developed as a comprehensive engineering assignment given by <span className="text-slate-900 dark:text-white font-bold">Navjot Kaur @ Softsensor.ai</span> (May 30, 2026).
          </p>
        </div>
      </div>
    </motion.div>
  );
}
