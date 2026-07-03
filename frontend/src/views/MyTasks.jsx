import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { slugify } from '../utils/slugify';
import StatusBadge from '../components/StatusBadge';
import { CheckSquare, Calendar, ChevronRight } from 'lucide-react';

export default function MyTasks() {
  const { user } = useAuth();
  const { allTasks } = useWorkspace();
  const navigate = useNavigate();

  // Filter tasks using database assignee_id
  const myTasks = allTasks.filter(t => t.assignee_id === user?.id);

  const todayStr = new Date().toISOString().substring(0, 10);

  return (
    <div className="p-8 max-w-4xl mx-auto font-sans">
      <div className="pb-6 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 flex items-center gap-2">
            <CheckSquare className="text-fuchsia-600" size={24} />
            My Tasks
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Tasks assigned to you across all active workspace project boards.
          </p>
        </div>
        <span className="px-3 py-1 bg-fuchsia-50 text-fuchsia-700 text-xs font-bold rounded-full">
          {myTasks.length} Assigned
        </span>
      </div>

      <div className="mt-8 space-y-4">
        {myTasks.map(task => {
          const isOverdue = task.status !== 'done' && task.due_date && task.due_date.substring(0, 10) < todayStr;
          
          return (
            <div
              key={task.id}
              onClick={() => navigate(`/workspaces/${slugify(task.workspaceName || '')}/${slugify(task.projectName || '')}/tasks/${task.id}`)}
              className="border border-gray-200 rounded-2xl p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 bg-white flex items-center justify-between cursor-pointer group"
            >
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                    {task.projectName || 'Project Board'}
                  </span>
                  <span className="text-[10px] font-extrabold text-fuchsia-600 bg-fuchsia-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                    {task.workspaceName || 'Workspace'}
                  </span>
                  {task.due_date && (
                    <span className={`text-[10px] font-bold flex items-center gap-0.5 ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                      <Calendar size={10} /> {task.due_date.substring(0, 10)}
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-extrabold text-gray-900 group-hover:text-fuchsia-600 transition-colors truncate">
                  {task.title}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5 truncate leading-relaxed">
                  {task.description || 'No description provided.'}
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <StatusBadge status={task.status} />
                <ChevronRight size={16} className="text-gray-300 group-hover:text-fuchsia-600 transition-colors" />
              </div>
            </div>
          );
        })}

        {myTasks.length === 0 && (
          <div className="border-2 border-dashed border-gray-100 rounded-2xl p-12 text-center text-gray-400">
            🎉 Clean slate! You have no tasks assigned.
          </div>
        )}
      </div>
    </div>
  );
}
