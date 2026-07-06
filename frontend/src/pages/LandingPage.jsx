import React, { useState, useEffect } from 'react';
import HeroSection from '../components/landing/HeroSection';
import ContextBanner from '../components/landing/ContextBanner';
import BentoGrid from '../components/landing/BentoGrid';
import ArchitectSection from '../components/landing/ArchitectSection';
import Roadmap from '../components/landing/Roadmap';
import { Rocket, ArrowRight, GitBranch, Moon, Sun, Briefcase } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function LandingPage() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('orbit-theme');
    return saved ? saved === 'dark' : true;
  });

  // Toggle theme logic
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('orbit-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('orbit-theme', 'light');
    }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-200 font-sans selection:bg-indigo-500/30 overflow-x-hidden transition-colors duration-300">
      
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          
          <div className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            <Rocket className="text-indigo-600 dark:text-indigo-500" /> Orbit
          </div>
          
          <div className="flex items-center gap-4">
            <a href="https://github.com/chhayanshporwal/orbit-workspace" target="_blank" rel="noopener noreferrer" className="relative group text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors hidden sm:block">
              <GitBranch className="w-5 h-5" />
              <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-900 dark:bg-slate-800 text-slate-100 text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-lg">Source Code</span>
            </a>
            <a href="https://chhayanshporwal.github.io/" target="_blank" rel="noopener noreferrer" className="relative group text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors hidden sm:block">
              <Briefcase className="w-5 h-5" />
              <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-900 dark:bg-slate-800 text-slate-100 text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-lg">Portfolio</span>
            </a>
            
            <button 
              onClick={toggleTheme} 
              className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              aria-label="Toggle dark mode"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            
            <div className="w-px h-5 bg-slate-300 dark:bg-slate-700 mx-2 hidden sm:block"></div>
            
            <Link to="/home" className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors flex items-center">
              Enter Workspace <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Assembled Page Sections */}
      <main>
        <HeroSection />
        <ContextBanner />
        <BentoGrid />
        <Roadmap />
        <ArchitectSection />
      </main>

      {/* Footer */}
      <footer className="py-8 text-center text-slate-500 dark:text-slate-500 text-sm border-t border-slate-200 dark:border-slate-800 transition-colors duration-300">
        <p>© {new Date().getFullYear()} Orbit Workspace. Engineered by Chhayansh Porwal.</p>
      </footer>
    </div>
  );
}
