import React from 'react';
import { motion } from 'framer-motion';
import { Database, Zap, Activity, ShieldCheck } from 'lucide-react';

export default function BentoGrid() {
  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.15 } }
  };
  
  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 100 } }
  };

  return (
    <section id="architecture" className="py-24 px-6 max-w-7xl mx-auto">
      <div className="mb-16">
        <h2 className="text-3xl md:text-4xl font-bold mb-4 text-slate-900 dark:text-slate-100 tracking-tight transition-colors duration-300">The Implemented Feats</h2>
        <p className="text-slate-600 dark:text-slate-400 text-lg max-w-2xl transition-colors duration-300">Architected for scale. We successfully pushed beyond the MVP constraints, implementing massive structural refactors and robust distributed systems.</p>
      </div>

      <motion.div 
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-100px" }}
        className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-[250px]"
      >
        {/* Card A: Wide Card (col-span-2) */}
        <motion.div variants={item} className="md:col-span-2 row-span-1 group relative p-[1px] rounded-3xl bg-gradient-to-br from-slate-200 to-white dark:from-slate-700 dark:to-slate-900 overflow-hidden transition-all duration-300">
          <div className="absolute inset-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-3xl transition-colors group-hover:bg-white/70 dark:group-hover:bg-slate-900/70"></div>
          <div className="relative h-full p-8 flex flex-col justify-end">
            <div className="absolute top-8 right-8 text-indigo-500/20 dark:text-indigo-500/50 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
              <Database className="w-12 h-12" />
            </div>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2 transition-colors duration-300">V2 Architecture: Domain-Driven</h3>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed transition-colors duration-300">
              Extracted a monolithic backend into scalable, modular domains with strict RBAC, multi-tenant security, and Redis-backed state management for bulletproof performance.
            </p>
          </div>
        </motion.div>

        {/* Card B: Standard Card */}
        <motion.div variants={item} className="md:col-span-1 row-span-1 group relative p-[1px] rounded-3xl bg-gradient-to-br from-slate-200 to-white dark:from-slate-700 dark:to-slate-900 overflow-hidden transition-all duration-300">
          <div className="absolute inset-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-3xl transition-colors group-hover:bg-white/70 dark:group-hover:bg-slate-900/70"></div>
          <div className="relative h-full p-8 flex flex-col justify-end">
            <div className="absolute top-8 right-8 text-teal-500/20 dark:text-teal-500/50 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
              <Zap className="w-12 h-12" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2 transition-colors duration-300">Smart Algorithms</h3>
            <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed transition-colors duration-300">
              <strong>Urgency Engine:</strong> Dynamic 0-100 deadline scoring.<br/>
              <strong>Workload Balancer:</strong> Intelligent auto-assign based on active capacity.
            </p>
          </div>
        </motion.div>

        {/* Card C: Standard Card */}
        <motion.div variants={item} className="md:col-span-1 row-span-1 group relative p-[1px] rounded-3xl bg-gradient-to-br from-slate-200 to-white dark:from-slate-700 dark:to-slate-900 overflow-hidden transition-all duration-300">
          <div className="absolute inset-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-3xl transition-colors group-hover:bg-white/70 dark:group-hover:bg-slate-900/70"></div>
          <div className="relative h-full p-8 flex flex-col justify-end">
            <div className="absolute top-8 right-8 text-emerald-500/20 dark:text-emerald-500/50 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
              <Activity className="w-12 h-12" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2 transition-colors duration-300">Real-Time WebSockets</h3>
            <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed transition-colors duration-300">
              FastAPI-driven instant cross-client synchronization. Watch drag-and-drop kanban events and comments appear globally with zero polling.
            </p>
          </div>
        </motion.div>

        {/* Card D: Wide Card */}
        <motion.div variants={item} className="md:col-span-2 row-span-1 group relative p-[1px] rounded-3xl bg-gradient-to-br from-slate-200 to-white dark:from-slate-700 dark:to-slate-900 overflow-hidden transition-all duration-300">
          <div className="absolute inset-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-3xl transition-colors group-hover:bg-white/70 dark:group-hover:bg-slate-900/70"></div>
          <div className="relative h-full p-8 flex flex-col justify-end">
            <div className="absolute top-8 right-8 text-blue-500/20 dark:text-blue-500/50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              <ShieldCheck className="w-12 h-12" />
            </div>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2 transition-colors duration-300">The Safety Net & Deployment</h3>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed transition-colors duration-300">
              Bulletproof CI/CD pipelines via GitHub Actions, rigorous E2E testing (Playwright + Pytest), and a full-stack Dockerized production environment served securely behind an Nginx reverse proxy.
            </p>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
