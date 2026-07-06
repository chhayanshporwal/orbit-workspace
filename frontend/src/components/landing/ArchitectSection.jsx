import React from 'react';
import { motion } from 'framer-motion';
import { GitBranch, Briefcase, Code } from 'lucide-react';

export default function ArchitectSection() {
  return (
    <section className="py-24 px-6 bg-slate-100 dark:bg-slate-900/50 border-y border-slate-200 dark:border-slate-800 transition-colors duration-300">
      <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-12">
        <motion.div 
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="w-48 h-48 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 p-1 flex-shrink-0 shadow-xl"
        >
          <div className="w-full h-full rounded-full bg-white dark:bg-slate-950 flex items-center justify-center overflow-hidden border-[6px] border-white dark:border-slate-950 transition-colors duration-300">
             {/* Profile image placeholder */}
             <img src="/profile.jpg" alt="Chhayansh Porwal" className="w-full h-full object-cover" onError={(e) => {
               // Fallback if image doesn't exist in public folder
               e.target.onerror = null; 
               e.target.src = "https://github.com/chhayanshporwal.png";
             }} />
          </div>
        </motion.div>
        
        <motion.div 
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          className="space-y-6 text-center md:text-left"
        >
          <div>
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2 transition-colors duration-300">Built by Chhayansh Porwal</h2>
            <p className="text-indigo-600 dark:text-indigo-400 font-medium transition-colors duration-300">Full-Stack Software Engineer</p>
          </div>

          <div className="flex items-center justify-center md:justify-start gap-4">
            <a href="https://github.com/chhayanshporwal" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors">
              <GitBranch className="w-4 h-4" /> GitHub Profile
            </a>
            <a href="https://chhayanshporwal.github.io/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50 transition-colors">
              <Briefcase className="w-4 h-4" /> Portfolio
            </a>
          </div>

          <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-lg transition-colors duration-300">
            This project represents a relentless focus on writing clean, scalable, and highly disciplined code. 
            The journey evolved from establishing a rock-solid foundation—designing a normalized PostgreSQL schema 
            and implementing strict JWT auth—all the way to enterprise-level polish.
          </p>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-lg transition-colors duration-300">
            By containerizing the entire stack via Docker and implementing rigorous Playwright E2E testing, Orbit stands as a testament to mature architectural design and engineering excellence.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
