import React from 'react';

export default function StatusBadge({ status }) {
  const normStatus = (status || '').toLowerCase().replace(/\s+/g, '');

  const config = {
    todo: {
      label: 'To Do',
      classes: 'bg-blue-50 text-blue-700 border border-blue-200',
    },
    inprogress: {
      label: 'In Progress',
      classes: 'bg-amber-50 text-amber-700 border border-amber-200',
    },
    done: {
      label: 'Done',
      classes: 'bg-green-50 text-green-700 border border-green-200',
    },
  };

  const current = config[normStatus] || {
    label: status,
    classes: 'bg-gray-50 text-gray-700 border border-gray-200',
  };

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold select-none ${current.classes}`}>
      <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-current opacity-70"></span>
      {current.label}
    </span>
  );
}
