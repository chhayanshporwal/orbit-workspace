import React from 'react';

// Simple helper to get a consistent background color based on initials/name
const getColorByString = (str) => {
  const colors = [
    'bg-fuchsia-600 text-white',
    'bg-indigo-600 text-white',
    'bg-teal-600 text-white',
    'bg-amber-500 text-amber-950',
    'bg-emerald-600 text-white',
    'bg-rose-600 text-white',
    'bg-sky-600 text-white',
    'bg-violet-600 text-white',
  ];
  if (!str) return colors[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

export default function Avatar({
  initials = '??',
  name = '',
  size = 'md',
  className = '',
  onClick,
}) {
  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm font-semibold',
    lg: 'w-12 h-12 text-base font-bold',
    xl: 'w-16 h-16 text-xl font-extrabold',
  };

  const bgClass = getColorByString(name || initials);

  return (
    <div
      title={name || initials}
      onClick={onClick}
      className={`relative inline-flex items-center justify-center rounded-full select-none shadow-inner shrink-0 ${sizeClasses[size]} ${bgClass} ${onClick ? 'cursor-pointer hover:opacity-90 active:scale-95 transition-all' : ''} ${className}`}
    >
      {initials.toUpperCase().slice(0, 2)}
    </div>
  );
}
