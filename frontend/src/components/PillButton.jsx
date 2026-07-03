import React from 'react';

export default function PillButton({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}) {
  const baseStyle = 'inline-flex items-center justify-center font-medium rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';

  const variants = {
    primary: 'bg-fuchsia-600 hover:bg-fuchsia-700 text-white shadow-sm hover:shadow focus:ring-fuchsia-500 hover:-translate-y-0.5 active:translate-y-0 active:shadow-none',
    secondary: 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 shadow-sm hover:shadow focus:ring-gray-400 hover:-translate-y-0.5 active:translate-y-0 active:shadow-none',
    danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm hover:shadow focus:ring-red-500 hover:-translate-y-0.5 active:translate-y-0 active:shadow-none',
    ghost: 'bg-transparent hover:bg-gray-100 text-gray-600 focus:ring-gray-400',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-5 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      type={type}
      className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
