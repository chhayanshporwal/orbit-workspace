import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Code2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function HeroSection() {
  const fadeInUp = {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" } }
  };

  return (
    <section className="relative pt-32 pb-20 px-6 overflow-hidden flex flex-col items-center justify-center text-center min-h-[90vh]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100/50 via-slate-50 to-slate-50 dark:from-indigo-900/40 dark:via-slate-950 dark:to-slate-950 pointer-events-none transition-colors duration-300"></div>
      
      <motion.div initial="hidden" animate="visible" variants={fadeInUp} className="z-10 max-w-5xl mx-auto">
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 text-slate-900 dark:text-slate-100 transition-colors duration-300">
          Orbit: Collaboration,<br className="hidden md:block"/> Engineered to Scale.
        </h1>
        <p className="text-lg md:text-xl text-slate-600 dark:text-slate-400 max-w-3xl mx-auto mb-10 leading-relaxed transition-colors duration-300">
          A lightweight yet powerful blend of Trello, Asana, and Slack. Built from the ground up to demonstrate absolute mastery across every major area of full-stack software engineering.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/home" className="inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-white bg-indigo-600 rounded-full hover:bg-indigo-500 transition-all shadow-[0_0_20px_-5px_rgba(99,102,241,0.4)] dark:shadow-[0_0_30px_-10px_rgba(99,102,241,0.6)]">
            Get Started Free <ArrowRight className="ml-2 w-5 h-5" />
          </Link>
          <a href="#architecture" className="inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-slate-700 dark:text-slate-300 bg-white/50 dark:bg-slate-800/50 backdrop-blur-md border border-slate-200 dark:border-slate-700/50 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
            View Architecture <Code2 className="ml-2 w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </a>
        </div>
      </motion.div>
    </section>
  );
}
