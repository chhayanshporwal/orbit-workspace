import React from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Server, Workflow, CheckCircle2, Smartphone } from 'lucide-react';

export default function Roadmap() {
  const roadmapItems = [
    {
      icon: <ShieldAlert className="w-6 h-6 text-indigo-500 dark:text-indigo-400" />,
      title: "Phase 1: Observability & Monitoring",
      description: "Integrating Sentry (backend and frontend) to capture unhandled 500 errors, client-side crashes, and meticulously trace API performance bottlenecks in real-time."
    },
    {
      icon: <Server className="w-6 h-6 text-purple-500 dark:text-purple-400" />,
      title: "Phase 2: Background Processing",
      description: "Offloading heavy tasks (like email dispatch and analytics aggregations) away from the FastAPI event loop to a dedicated Celery worker backed by Redis."
    },
    {
      icon: <Workflow className="w-6 h-6 text-teal-500 dark:text-teal-400" />,
      title: "Phase 3: State Management",
      description: "Migrating from React Context to Redux Toolkit to eliminate unnecessary UI re-renders on massive Kanban boards, ensuring pristine 60FPS UI performance under load."
    },
    {
      icon: <CheckCircle2 className="w-6 h-6 text-fuchsia-500 dark:text-fuchsia-400" />,
      title: "Phase 4: Frontend Testing Suite",
      description: "Implementing robust E2E testing using Playwright to automatically verify critical user journeys, authentication flows, and UI stability across multiple browsers."
    },
    {
      icon: <Smartphone className="w-6 h-6 text-sky-500 dark:text-sky-400" />,
      title: "Phase 5: Mobile & Media Expansion",
      description: "Refining the responsive UI for perfect cross-device harmony, supporting file attachments on tasks, and developing a native mobile application."
    }
  ];

  return (
    <section className="py-24 px-6 max-w-5xl mx-auto">
      <div className="text-center mb-16">
        <h2 className="text-3xl md:text-4xl font-bold mb-4 text-slate-900 dark:text-slate-100 tracking-tight transition-colors duration-300">The Future Roadmap</h2>
        <p className="text-slate-600 dark:text-slate-400 text-lg max-w-2xl mx-auto transition-colors duration-300">The next phases for ultimate observability and scale. Transitioning from MVP architecture to enterprise readiness.</p>
      </div>

      <div className="space-y-6">
        {roadmapItems.map((item, index) => (
          <motion.div 
            key={index}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.2 }}
            className="group relative p-[1px] rounded-2xl bg-gradient-to-r from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 hover:from-indigo-400/50 hover:to-purple-400/50 dark:hover:from-indigo-500/50 dark:hover:to-purple-500/50 transition-all duration-500"
          >
            <div className="absolute inset-0 bg-white/95 dark:bg-slate-900/95 rounded-2xl backdrop-blur-xl transition-colors duration-300"></div>
            <div className="relative p-6 md:p-8 flex items-start gap-6">
              <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-inner transition-colors duration-300">
                {item.icon}
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-200 mb-2 transition-colors duration-300">{item.title}</h3>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed transition-colors duration-300">{item.description}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
