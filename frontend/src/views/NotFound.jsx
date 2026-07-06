import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, MoveLeft } from 'lucide-react';
import PillButton from '../components/PillButton';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 font-sans">
      <div className="text-center max-w-md flex flex-col items-center">
        {/* Floating Compass Icon */}
        <div className="w-20 h-20 flex items-center justify-center animate-pulse mb-8">
          <img src="/favicon.svg" alt="Orbit" className="w-20 h-20 animate-spin-slow" />
        </div>

        {/* 404 Heading */}
        <h1 className="text-8xl font-black text-gray-900 tracking-tight leading-none bg-gradient-to-r from-fuchsia-600 to-indigo-600 bg-clip-text text-transparent">
          404
        </h1>
        <h2 className="text-xl font-extrabold text-gray-900 tracking-tight mt-4">
          Page Not Found
        </h2>
        <p className="text-xs text-gray-500 mt-2 leading-relaxed">
          The page you are looking for doesn't exist, was moved, or you don't have authorization to view it.
        </p>

        {/* Back button */}
        <div className="mt-8">
          <PillButton variant="primary" size="md" onClick={() => navigate('/workspaces')}>
            <div className="flex items-center gap-1.5">
              <MoveLeft size={16} />
              Return to Workspaces
            </div>
          </PillButton>
        </div>
      </div>
    </div>
  );
}
