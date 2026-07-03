import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { slugify } from '../utils/slugify';
import StatusBadge from '../components/StatusBadge';
import { api } from '../utils/api';
import { showToast } from '../components/Toast';
import { Compass, CheckSquare, Calendar, ChevronRight, Activity, Bell, Layers, Database, MessageSquare, FileArchive } from 'lucide-react';

export default function Home() {
  const { user } = useAuth();
  const { allTasks, allTasksLoading, fetchWorkspaces, notifications, workspaces, userProjectViews, allProjects } = useWorkspace();
  const navigate = useNavigate();
  const [auditLogs, setAuditLogs] = useState([]);

  useEffect(() => {
    // Refresh workspaces and tasks on mount to ensure home is populated
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const data = await api.get('/audit-logs');
        if (data) {
          setAuditLogs(data);
        }
      } catch (err) {
        console.error('Failed to fetch audit logs:', err);
      }
    };
    if (user) {
      fetchLogs();
    }
  }, [user]);

  const todayStr = new Date().toISOString().substring(0, 10);

  // Filter tasks assigned to me and NOT completed
  const myAssignedTasks = allTasks.filter(t => t.assignee_id === user?.id && t.status !== 'done');

  // Group activities by project for new updates since last login
  const projectUpdates = {};
  auditLogs.forEach(log => {
    const isDeletion = log.action === 'workspace_deleted' || log.action === 'project_deleted';
    const isWorkspaceEvent = !log.project_id;
    const projId = isDeletion ? 'archive' : (isWorkspaceEvent ? `ws-${log.workspace_id}` : log.project_id);
    
    // Check if parent workspace/project still exists (unless it's an archive log)
    const ws = workspaces.find(w => Number(w.id) === Number(log.workspace_id));
    const proj = !isWorkspaceEvent ? allProjects?.find(p => Number(p.id) === Number(log.project_id)) : null;
    
    if (!isDeletion) {
      if (!ws) return; // Orphan log for deleted workspace
      if (!isWorkspaceEvent && !proj) return; // Orphan log for deleted project
    }

    // Check if log is newer than last viewed time for this project/workspace
    const lastViewed = isDeletion ? localStorage.getItem('archive_last_viewed') : userProjectViews?.[projId];
    // For workspace events without a tracker, default to always showing them if they occurred in the last 7 days
    const isRecentWorkspaceEvent = (isWorkspaceEvent || isDeletion) && (new Date() - new Date(log.created_at)) < 7 * 24 * 60 * 60 * 1000;
    
    const isNew = lastViewed ? new Date(log.created_at) > new Date(lastViewed) : (isWorkspaceEvent || isDeletion ? isRecentWorkspaceEvent : true);
    if (!isNew) return;

    if (!projectUpdates[projId]) {
      projectUpdates[projId] = {
        projectId: projId,
        isWorkspaceEvent,
        projectName: isDeletion ? 'System Archive' : (isWorkspaceEvent ? 'Workspace Admin' : proj.name),
        workspaceName: isDeletion ? 'Orbit Core' : ws.name,
        count: 0,
        latestTime: new Date(log.created_at),
        workspaceSlug: ws ? slugify(ws.name) : '',
        projectSlug: proj ? slugify(proj.name) : '',
        latestDetail: log.details,
      };
    }
    projectUpdates[projId].count += 1;
    if (new Date(log.created_at) > projectUpdates[projId].latestTime) {
      projectUpdates[projId].latestTime = new Date(log.created_at);
      projectUpdates[projId].latestDetail = log.details;
    }
  });

  const bundledActivities = Object.values(projectUpdates).sort((a, b) => b.latestTime - a.latestTime);


  return (
    <div className="p-8 max-w-6xl mx-auto font-sans text-left">
      {/* Welcome Header */}
      <div className="pb-6 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 flex items-center gap-2">
            <Compass className="text-fuchsia-600" size={26} />
            Hello, {user?.name || 'User'}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Here is your collaborative dashboard activity for today, {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
        
        {/* Left Column: Tasks Assigned to Me (Span 2) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                <CheckSquare size={16} className="text-fuchsia-600" />
                Tasks Assigned to Me
              </h2>
              <span className="px-2.5 py-1 bg-fuchsia-50 text-fuchsia-700 text-[10px] font-black rounded-full">
                {myAssignedTasks.length} Pending
              </span>
            </div>

            {allTasksLoading ? (
              <div className="py-12 text-center text-xs text-gray-400 font-semibold animate-pulse">
                Synchronizing task engine across workspaces...
              </div>
            ) : myAssignedTasks.length > 0 ? (
              <div className="space-y-3.5">
                {myAssignedTasks.map(task => {
                  const isOverdue = task.due_date && task.due_date.substring(0, 10) < todayStr;
                  return (
                    <div
                      key={task.id}
                      onClick={() => navigate(`/workspaces/${slugify(task.workspaceName || '')}/${slugify(task.projectName || '')}/tasks/${task.id}`)}
                      className="border border-gray-100 rounded-2xl p-4.5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 bg-white flex items-center justify-between cursor-pointer group"
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] font-black text-fuchsia-700 bg-fuchsia-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                            {task.workspaceName || 'Workspace'}
                          </span>
                          <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                            {task.projectName || 'Project'}
                          </span>
                          {task.due_date && (
                            <span className={`text-[10px] font-bold flex items-center gap-0.5 ${isOverdue ? 'text-red-500 font-extrabold' : 'text-gray-400'}`}>
                              <Calendar size={10} /> {task.due_date.substring(0, 10)}
                            </span>
                          )}
                        </div>
                        <h3 className="text-xs font-extrabold text-gray-900 group-hover:text-fuchsia-600 transition-colors truncate">
                          {task.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        <StatusBadge status={task.status} />
                        <ChevronRight size={14} className="text-gray-300 group-hover:text-fuchsia-600 transition-colors" />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="border border-dashed border-gray-100 rounded-2xl p-12 text-center text-gray-400 text-xs font-semibold">
                🎉 All caught up! No pending tasks assigned to you.
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Activity Feed / Audit Log */}
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs">
            <h2 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider mb-6 flex items-center gap-2">
              <Activity size={16} className="text-fuchsia-600" />
              Activity Log
            </h2>
            <div className="space-y-4">
              {bundledActivities.length > 0 ? (
                bundledActivities.slice(0, 8).map((bundle) => (
                  <div 
                    key={bundle.projectId}
                    onClick={() => {
                      if (bundle.projectId === 'archive') {
                        navigate('/settings?tab=archive');
                        return;
                      }
                      if (!bundle.workspaceSlug) {
                        showToast('info', 'This workspace has been deleted and is no longer accessible.');
                        return;
                      }
                      if (bundle.isWorkspaceEvent) {
                        navigate(`/workspaces/${bundle.workspaceSlug}/dashboard?tab=audit_log`);
                      } else {
                        navigate(`/workspaces/${bundle.workspaceSlug}/${bundle.projectSlug}?tab=audit_log`);
                      }
                    }}
                    className={`border border-gray-100 rounded-xl p-4 transition-all duration-200 bg-white group hover:shadow-md cursor-pointer`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${bundle.projectId === 'archive' ? 'text-rose-600 bg-rose-50' : 'text-indigo-600 bg-indigo-50'}`}>
                        {bundle.projectName}
                      </span>
                      <span className="text-[10px] text-gray-400 font-bold">
                        {bundle.latestTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-gray-800 group-hover:text-fuchsia-600 transition-colors">
                      {bundle.projectId === 'archive' ? (
                        `${bundle.count} deletion log${bundle.count !== 1 ? 's' : ''} archived since last view`
                      ) : (
                        `${bundle.count} new update${bundle.count !== 1 ? 's' : ''} since you last viewed`
                      )}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-1 font-semibold">
                      in {bundle.workspaceName}
                    </p>
                  </div>
                ))
              ) : (
                <div className="text-center text-xs text-gray-400 italic py-6">
                  No new updates since you last viewed these projects.
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
