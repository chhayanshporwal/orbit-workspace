import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Outlet, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useProjectWebSocket } from '../hooks/useProjectWebSocket';
import { slugify } from '../utils/slugify';
import PillButton from '../components/PillButton';
import StatusBadge from '../components/StatusBadge';
import Avatar from '../components/Avatar';
import Modal from '../components/Modal';
import { api } from '../utils/api';
import { showToast } from '../components/Toast';
import {
  Sparkles,
  Plus,
  Calendar,
  Users,
  Filter,
  Lock,
  Trash2,
  BarChart3,
  Activity,
  Database,
  Bell,
  ClipboardList,
  CheckCircle,
  Clock,
  CheckSquare,
  Edit3,
  MessageSquare,
  Layers
} from 'lucide-react';

export default function KanbanBoard() {
  const { workspaceSlug, projectSlug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const {
    workspaces,
    projects,
    allProjects,
    tasks,
    activeWorkspace,
    role,
    createTask,
    updateTask,
    deleteProject,
    updateProject,
    smartAssignTask,
    notifications,
    userProjectViews,
    updateUserProjectView
  } = useWorkspace();

  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'board'); // 'board', 'analytics', 'audit_log'

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [searchParams, activeTab]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };



  // Resolve slugs → real workspace & project (done before hooks that depend on IDs)
  const ws = workspaces.find(w => slugify(w.name) === workspaceSlug);
  const project = allProjects.find(p => slugify(p.name) === projectSlug && (ws ? p.workspace_id === ws.id : true))
    || projects.find(p => slugify(p.name) === projectSlug);

  const [initialLastViewed, setInitialLastViewed] = useState(null);

  // Sync when audit_log is opened
  useEffect(() => {
    if (activeTab === 'audit_log' && project) {
      setInitialLastViewed(userProjectViews?.[project.id] || null);
      updateUserProjectView(project.id);
    }
  }, [activeTab, project]);

  // Project WebSocket for Collaborative Drag and Drop
  const { activeDrags, broadcastEvent } = useProjectWebSocket(project?.id);

  // Mock connection status to true since global websocket sync is active
  const connected = true;

  // State to hold PostgreSQL audit logs from backend
  const [workspaceLogs, setWorkspaceLogs] = useState([]);

  useEffect(() => {
    const fetchWorkspaceLogs = async () => {
      if (!ws) return;
      try {
        const data = await api.get(`/workspaces/${ws.id}/audit-logs`);
        if (data) {
          setWorkspaceLogs(data);
        }
      } catch (err) {
        console.error('Failed to fetch workspace logs:', err);
      }
    };
    fetchWorkspaceLogs();
  }, [ws]);

  // New Task states
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newPriority, setNewPriority] = useState('1');
  const [newDesc, setNewDesc] = useState('');
  const [formErrors, setFormErrors] = useState({});

  // Smart Assign states
  const [isSmartAssignOpen, setIsSmartAssignOpen] = useState(false);
  const [smartTitle, setSmartTitle] = useState('');
  const [smartDueDate, setSmartDueDate] = useState('');
  const [smartDesc, setSmartDesc] = useState('');

  // Filtering states
  const [searchFilter, setSearchFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Edit Project states
  const [isEditProjectOpen, setIsEditProjectOpen] = useState(false);
  const [editProjectTitle, setEditProjectTitle] = useState('');
  const [editProjectDesc, setEditProjectDesc] = useState('');
  const [isDeleteProjectOpen, setIsDeleteProjectOpen] = useState(false);

  const todayStr = new Date().toISOString().substring(0, 10);

  if (!project) {
    return <div className="p-8 text-center text-gray-500 font-sans">Project not found</div>;
  }

  // Filter tasks of this project
  const projectTasks = tasks.filter(t => t.project_id === project.id);

  // Filter tasks based on UI controls
  const filteredTasks = projectTasks.filter(t => {
    const matchesSearch = (t.title || '').toLowerCase().includes(searchFilter.toLowerCase()) || 
                          (t.description || '').toLowerCase().includes(searchFilter.toLowerCase());
    
    const matchesAssignee = assigneeFilter === 'all' || t.assignee_id === parseInt(assigneeFilter);
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    
    return matchesSearch && matchesAssignee && matchesStatus;
  });

  // Split tasks by column
  const todoList = filteredTasks.filter(t => t.status === 'todo');
  const inProgressList = filteredTasks.filter(t => t.status === 'inprogress');
  const doneList = filteredTasks.filter(t => t.status === 'done');

  const handleCreateTask = (e) => {
    e.preventDefault();
    const errors = {};
    if (!newTitle.trim()) errors.title = 'Title is required';
    if (!newAssignee) errors.assignee = 'Assignee is required';
    if (!newDueDate) errors.dueDate = 'Due Date is required';
    if (!newPriority) errors.priority = 'Priority level is required';

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    createTask(project.id, {
      title: newTitle.trim(),
      assigneeId: newAssignee,
      dueDate: newDueDate,
      priority_level: parseInt(newPriority),
      description: newDesc.trim()
    });

    setNewTitle('');
    setNewAssignee('');
    setNewDueDate('');
    setNewPriority('1');
    setNewDesc('');
    setFormErrors({});
    setIsNewTaskOpen(false);
  };

  const handleSmartAssign = (e) => {
    e.preventDefault();
    const cleanTitle = smartTitle.trim();
    if (!cleanTitle) return;
    smartAssignTask(project.id, {
      title: cleanTitle,
      dueDate: smartDueDate,
      description: smartDesc.trim()
    });
    setSmartTitle('');
    setSmartDueDate('');
    setSmartDesc('');
    setIsSmartAssignOpen(false);
  };

  const handleDeleteProject = async () => {
    await deleteProject(project.id);
    setIsDeleteProjectOpen(false);
    showToast('success', 'Project successfully deleted.');
    navigate(`/workspaces/${slugify(activeWorkspace?.name || '')}/dashboard`);
  };

  const handleEditProject = async (e) => {
    e.preventDefault();
    const cleanTitle = editProjectTitle.trim();
    const cleanDesc = editProjectDesc.trim();
    if (!cleanTitle) {
      showToast('error', 'Project name cannot be empty.');
      return;
    }
    await updateProject(project.id, cleanTitle, cleanDesc);
    showToast('success', 'Project details successfully updated.');
    setIsEditProjectOpen(false);
  };

  const openEditProjectModal = () => {
    setEditProjectTitle(project.name);
    setEditProjectDesc(project.description || '');
    setIsEditProjectOpen(true);
  };

  // HTML5 Drag and Drop handlers
  const handleDragStart = (e, taskId) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.currentTarget.classList.add('opacity-40');
    broadcastEvent({ event: 'drag_start', task_id: taskId });
  };

  const handleDragEnd = (e) => {
    e.currentTarget.classList.remove('opacity-40');
    // We don't have task ID easily here unless passed, but HTML drop usually finishes fast.
    // It's better to fire drag_end in handleDrop, but we can also broadcast it here if we pass taskId.
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, targetStatus) => {
    e.preventDefault();
    if (role.isViewer) {
      alert('Permission Denied: Viewers cannot move tasks.');
      return;
    }
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      broadcastEvent({ event: 'drag_end', task_id: parseInt(taskId) });
    }
    if (taskId) {
      const taskIdInt = parseInt(taskId);
      const task = tasks.find(t => t.id === taskIdInt);
      if (task) {
        const isCreator = task.assignor_id === user?.id;
        const isAssignee = task.assignee_id === user?.id;
        const isAdmin = role.isAdmin;

        if (!isCreator && !isAdmin && !isAssignee) {
          alert('Permission Denied: You cannot move this task.');
          return;
        }

        if (task.status === 'done' && targetStatus !== 'done') {
            if (!isCreator && !isAdmin) {
               alert('Permission Denied: Only the creator or an admin can unlock a Done task.');
               return;
            }
        }
        
        updateTask(taskIdInt, { status: targetStatus });
      }
    }
  };

  const isOverdue = (dueDate, status) => {
    if (!dueDate || status === 'done') return false;
    // Format incoming ISO string to YYYY-MM-DD for comparison
    const formatted = dueDate.substring(0, 10);
    return formatted < todayStr;
  };

  const renderAnalytics = () => {
    const totalTasks = projectTasks.length;
    const todo = projectTasks.filter(t => t.status === 'todo').length;
    const inprogress = projectTasks.filter(t => t.status === 'inprogress').length;
    const done = projectTasks.filter(t => t.status === 'done').length;
    const successRate = totalTasks > 0 ? (done / totalTasks) * 100 : 0;
    const overdueTasks = projectTasks.filter(t => isOverdue(t.due_date, t.status)).length;

    // SVG Wedge Calculation for Pie Chart
    const total = todo + inprogress + done;
    
    const todoPct = total > 0 ? (todo / total) * 100 : 0;
    const ipPct = total > 0 ? (inprogress / total) * 100 : 0;
    const donePct = total > 0 ? (done / total) * 100 : 0;

    let cumulativePercent = 0;
    const getCoordinates = (pct) => {
      const x = Math.cos(2 * Math.PI * pct);
      const y = Math.sin(2 * Math.PI * pct);
      return [x, y];
    };

    const getPath = (pct) => {
      if (pct === 0) return '';
      if (pct === 100) return `M 0 0.0001 A 1 1 0 1 1 0 -0.0001 Z`;
      const [startX, startY] = getCoordinates(cumulativePercent);
      cumulativePercent += pct;
      const [endX, endY] = getCoordinates(cumulativePercent);
      const largeArc = pct > 50 ? 1 : 0;
      return `M 0 0 L ${startX} ${startY} A 1 1 0 ${largeArc} 1 ${endX} ${endY} Z`;
    };

    const todoPath = getPath(todoPct / 100);
    const ipPath = getPath(ipPct / 100);
    const donePath = getPath(donePct / 100);

    // Compute Workload Breakdown by Member
    const currentWorkspace = workspaces.find(w => w.id === project.workspace_id) || activeWorkspace;
    const members = (currentWorkspace?.members || []).filter(m => (m.status || '').toLowerCase() === 'accepted');
    const workload = members.map(m => {
      const memberTasks = projectTasks.filter(t => t.assignee_id === m.id);
      const mTodo = memberTasks.filter(t => t.status === 'todo').length;
      const mIp = memberTasks.filter(t => t.status === 'inprogress').length;
      const mDone = memberTasks.filter(t => t.status === 'done').length;
      const mTotal = memberTasks.length;
      return { member: m, todo: mTodo, inprogress: mIp, done: mDone, total: mTotal };
    }).sort((a, b) => b.total - a.total);

    return (
      <div className="flex-1 overflow-y-auto p-8 bg-gray-50/20 font-sans space-y-8 animate-fadeIn">
        {/* Stat Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
              <ClipboardList size={20} />
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Total Tasks</span>
              <h4 className="text-2xl font-black text-gray-900 mt-0.5">{totalTasks}</h4>
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center text-green-600">
              <CheckCircle size={20} />
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Success Rate</span>
              <h4 className="text-2xl font-black text-gray-900 mt-0.5">{Math.round(successRate)}%</h4>
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center text-red-600">
              <Clock size={20} />
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Overdue Tasks</span>
              <h4 className="text-2xl font-black text-gray-900 mt-0.5">{overdueTasks}</h4>
            </div>
          </div>
        </div>

        {/* Charts & Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Status Pie Chart */}
          <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">Task Status Distribution</h3>
            {total === 0 ? (
              <div className="h-64 flex items-center justify-center text-xs text-gray-400 font-bold border-2 border-dashed border-gray-100 rounded-2xl">
                No tasks to analyze in this project.
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center justify-around gap-6 py-6">
                <div className="relative w-40 h-40">
                  <svg viewBox="-1.1 -1.1 2.2 2.2" className="w-full h-full -rotate-90">
                    {todoPct > 0 && <path d={todoPath} fill="#3b82f6" />}
                    {ipPct > 0 && <path d={ipPath} fill="#f59e0b" />}
                    {donePct > 0 && <path d={donePath} fill="#22c55e" />}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center flex-col bg-white rounded-full w-20 h-20 m-auto shadow-inner border border-gray-50">
                    <span className="text-[8px] font-bold text-gray-400 uppercase">Success</span>
                    <span className="text-base font-black text-gray-900">{Math.round(donePct)}%</span>
                  </div>
                </div>
                <div className="space-y-3 w-full sm:w-1/2">
                  <div className="flex items-center justify-between p-2.5 border border-gray-50 rounded-xl bg-gray-50/50">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                      <span className="text-xs font-bold text-gray-700">To Do</span>
                    </div>
                    <span className="text-xs font-black text-gray-900">{todo} ({Math.round(todoPct)}%)</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 border border-gray-50 rounded-xl bg-gray-50/50">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                      <span className="text-xs font-bold text-gray-700">In Progress</span>
                    </div>
                    <span className="text-xs font-black text-gray-900">{inprogress} ({Math.round(ipPct)}%)</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 border border-gray-50 rounded-xl bg-gray-50/50">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
                      <span className="text-xs font-bold text-gray-700">Done</span>
                    </div>
                    <span className="text-xs font-black text-gray-900">{done} ({Math.round(donePct)}%)</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Workload Breakdown */}
          <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">Team Workload Bandwidth</h3>
            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
              {workload.map(item => {
                const totalMTasks = item.total;
                const donePct = totalMTasks > 0 ? (item.done / totalMTasks) * 100 : 0;
                return (
                  <div key={item.member.id} className="flex flex-col gap-2 p-3 border border-gray-50 rounded-2xl hover:bg-gray-50/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Avatar initials={item.member.initials} name={item.member.name} size="xs" />
                        <span className="text-xs font-extrabold text-gray-800">{item.member.name}</span>
                      </div>
                      <span className="text-[10px] font-black text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        {totalMTasks} Tasks ({item.done} Done / {item.todo + item.inprogress} Open)
                      </span>
                    </div>
                    {totalMTasks > 0 && (
                      <div className="w-full h-1.5 rounded-full bg-gray-100 flex overflow-hidden">
                        <div style={{ width: `${(item.todo / totalMTasks) * 100}%` }} className="bg-blue-500 h-full"></div>
                        <div style={{ width: `${(item.inprogress / totalMTasks) * 100}%` }} className="bg-amber-500 h-full"></div>
                        <div style={{ width: `${donePct}%` }} className="bg-green-500 h-full"></div>
                      </div>
                    )}
                  </div>
                );
              })}
              {workload.length === 0 && (
                <div className="h-64 flex items-center justify-center text-xs text-gray-400 font-bold border-2 border-dashed border-gray-100 rounded-2xl">
                  No members added to this workspace.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAuditLog = () => {
    if (!project) return null;
    
    // Filter workspace logs that belong specifically to this project
    const projectLogs = workspaceLogs.filter(log => {
      return log.project_id === project.id;
    }).map(log => {
      let icon = <Bell size={14} className="text-fuchsia-500" />;
      let bg = 'bg-fuchsia-50';

      if (log.action.includes('task')) {
        icon = <CheckSquare size={14} className="text-indigo-500" />;
        bg = 'bg-indigo-50';
      } else if (log.action.includes('member') || log.action.includes('invite')) {
        icon = <MessageSquare size={14} className="text-fuchsia-500" />;
        bg = 'bg-fuchsia-50';
      } else if (log.action.includes('project')) {
        icon = <Layers size={14} className="text-blue-500" />;
        bg = 'bg-blue-50';
      }

      return {
        id: `audit-${log.id}`,
        message: log.details,
        time: new Date(log.created_at),
        icon,
        bg,
        tag: log.action.replace('_', ' ')
      };
    });

    const logs = [...projectLogs].sort((a, b) => b.time - a.time);

    return (
      <div className="flex-1 overflow-y-auto p-8 bg-gray-50/20 font-sans space-y-6 animate-fadeIn">
        <div className="max-w-3xl bg-white border border-gray-100 rounded-3xl p-6 shadow-xs mx-auto">
          <div className="pb-4 border-b border-gray-100 flex justify-between items-center mb-6">
            <div>
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-gray-900 flex items-center gap-1.5">
                <Activity size={16} className="text-fuchsia-600" />
                Project Audit Timeline
              </h3>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                Replicated PostgreSQL activity logs and WebSocket sync telemetry.
              </p>
            </div>
            <span className="px-2 py-0.5 bg-fuchsia-50 text-fuchsia-700 text-[10px] font-black rounded-full uppercase tracking-wider">
              {logs.length} events
            </span>
          </div>

          <div className="relative border-l-2 border-gray-100 ml-4 space-y-6 py-2">
            {(() => {
              const renderedLogs = [];
              let separatorInjected = false;
              
              logs.forEach(log => {
                if (initialLastViewed && new Date(log.time) <= new Date(initialLastViewed) && !separatorInjected) {
                  if (renderedLogs.length > 0) {
                    renderedLogs.push({ isSeparator: true, id: 'separator' });
                  }
                  separatorInjected = true;
                }
                renderedLogs.push(log);
              });
              
              return renderedLogs.map((log) => {
                if (log.isSeparator) {
                  return (
                    <div key={log.id} className="relative py-4 -ml-4">
                      <div className="absolute inset-0 flex items-center" aria-hidden="true">
                        <div className="w-full border-t border-fuchsia-200 border-dashed"></div>
                      </div>
                      <div className="relative flex justify-center">
                        <span className="bg-white px-3 text-[10px] font-black text-fuchsia-600 uppercase tracking-widest shadow-sm border border-fuchsia-100 rounded-full">
                          Previously Viewed
                        </span>
                      </div>
                    </div>
                  );
                }

                const timeString = log.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const dateString = log.time.toLocaleDateString([], { month: 'short', day: 'numeric' });
                const lastViewed = userProjectViews?.[project?.id];
                const isNew = lastViewed && log.tag !== 'System' ? log.time > new Date(lastViewed) : !lastViewed && log.tag !== 'System';
                return (
                <div key={log.id} className={`relative pl-6 py-2 -ml-2 pr-2 rounded-xl transition-colors duration-1000 ${isNew ? 'bg-yellow-50/60 shadow-sm border border-yellow-100/50' : ''}`}>
                  {isNew && (
                    <span className="absolute top-2 right-2 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-fuchsia-500"></span>
                    </span>
                  )}
                  {/* Timeline bullet icon wrapper */}
                  <span className={`absolute -left-[14px] top-1 w-6 h-6 rounded-full ${log.bg} border-2 border-white flex items-center justify-center shadow-xs`}>
                    {log.icon}
                  </span>
                  
                  {/* Event Details */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                          log.tag === 'System' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-100'
                        }`}>
                          {log.tag}
                        </span>
                        <span className="text-xs font-semibold text-gray-800">
                          {log.message}
                        </span>
                      </div>
                    </div>
                    <span className="text-[9px] font-bold text-gray-400 whitespace-nowrap bg-gray-50 px-2 py-0.5 rounded-full self-start sm:self-center">
                      {dateString} • {timeString}
                    </span>
                  </div>
                </div>
              );
            })})()}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col font-sans relative">
      
      {/* Project Header */}
      <div className="bg-white border-b border-gray-100 px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-extrabold tracking-tight text-gray-900">
              {project.name}
            </h2>
            <div className="flex items-center gap-1.5" title="WebSocket project channel status">
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-ping' : 'bg-amber-400'}`}></span>
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                {connected ? 'Live Sync' : 'Connecting...'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-full border border-gray-200/50">
            <button
              onClick={() => handleTabChange('board')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                activeTab === 'board'
                  ? 'bg-white text-fuchsia-700 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Kanban Board
            </button>
            <button
              onClick={() => handleTabChange('analytics')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                activeTab === 'analytics'
                  ? 'bg-white text-fuchsia-700 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Analytics
            </button>
            <button
              onClick={() => handleTabChange('audit_log')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                activeTab === 'audit_log'
                  ? 'bg-white text-fuchsia-700 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Audit Log
            </button>
          </div>
        </div>

          <div className="flex items-center gap-2 mt-4 sm:mt-0">
            {role.isAdmin && (
              <PillButton 
                variant="outline" 
                size="sm" 
                onClick={openEditProjectModal}
                className="hidden sm:flex text-gray-500 border-gray-200"
              >
                <Edit3 size={14} className="mr-1.5" /> Edit Project
              </PillButton>
            )}
            {role.isAdmin && (
            <PillButton
              variant="secondary"
              size="sm"
              onClick={() => setIsSmartAssignOpen(true)}
              className="flex items-center gap-1.5 border-fuchsia-200 text-fuchsia-700 bg-fuchsia-50/20 hover:bg-fuchsia-50 hover:border-fuchsia-300"
              title="Automatically balance workload based on assignee bandwidth"
            >
              <Sparkles size={14} className="animate-sparkle text-fuchsia-600" />
              <span>Smart Assign</span>
            </PillButton>
          )}

          {role.isEditor && (
            <PillButton
              variant="primary"
              size="sm"
              onClick={() => setIsNewTaskOpen(true)}
              className="flex items-center gap-1"
            >
              <Plus size={14} />
              <span>New Task</span>
            </PillButton>
          )}

          {role.isAdmin && (
            <button
              onClick={() => setIsDeleteProjectOpen(true)}
              className="p-2 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors shrink-0 ml-1"
              title="Delete Project"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>

      </div>

      {activeTab === 'board' && (
        <>
          {/* Toolbar */}
          <div className="bg-gray-50/40 border-b border-gray-100 px-8 py-3 flex flex-wrap items-center gap-4 shrink-0">
            
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
              <Users size={14} className="text-gray-400" />
              <span>Assignee:</span>
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                className="bg-white border border-gray-200 rounded-full px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-fuchsia-500 text-gray-800 font-bold"
              >
                <option value="all">All Members</option>
                {activeWorkspace?.members?.filter(m => (m.status || '').toLowerCase() === 'accepted')?.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
              <Filter size={14} className="text-gray-400" />
              <span>Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-white border border-gray-200 rounded-full px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-fuchsia-500 text-gray-800 font-bold"
              >
                <option value="all">All Columns</option>
                <option value="todo">To Do</option>
                <option value="inprogress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>

            <div className="flex-1 min-w-[200px] md:max-w-xs ml-auto">
              <input
                type="text"
                placeholder="Search this board..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full px-4 py-1.5 border border-gray-200 rounded-full bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500"
              />
            </div>

          </div>

          {/* Board Layout */}
          <div className="flex-1 overflow-x-auto p-8 bg-white flex gap-6 items-start">
            
            {/* TO DO COLUMN */}
            {(statusFilter === 'all' || statusFilter === 'todo') && (
              <div
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, 'todo')}
                className="bg-slate-50 border border-gray-200/60 rounded-2xl p-4 flex flex-col flex-1 min-w-[320px] max-w-[500px] shrink-0 select-none min-h-[500px]"
              >
                <div className="flex items-center justify-between pb-3 border-b border-gray-200/50 mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                    <h4 className="text-sm font-extrabold text-gray-900 tracking-tight">To Do</h4>
                  </div>
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-black rounded-full">
                    {todoList.length}
                  </span>
                </div>

                <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-1">
                  {todoList.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      members={activeWorkspace?.members || []}
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onDragEnd={(e) => { handleDragEnd(e); broadcastEvent({ event: 'drag_end', task_id: task.id }); }}
                      onClick={() => navigate(`/workspaces/${workspaceSlug}/${projectSlug}/tasks/${task.id}`)}
                      overdue={isOverdue(task.due_date, task.status)}
                      isAdmin={role.isAdmin}
                      currentUserId={user?.id}
                      activeDrags={activeDrags}
                    />
                  ))}
                  {todoList.length === 0 && (
                    <div className="py-8 text-center text-xs text-gray-400 italic">No tasks here</div>
                  )}
                </div>
              </div>
            )}

            {/* IN PROGRESS COLUMN */}
            {(statusFilter === 'all' || statusFilter === 'inprogress') && (
              <div
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, 'inprogress')}
                className="bg-slate-50 border border-gray-200/60 rounded-2xl p-4 flex flex-col flex-1 min-w-[320px] max-w-[500px] shrink-0 select-none min-h-[500px]"
              >
                <div className="flex items-center justify-between pb-3 border-b border-gray-200/50 mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    <h4 className="text-sm font-extrabold text-gray-900 tracking-tight">In Progress</h4>
                  </div>
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-black rounded-full">
                    {inProgressList.length}
                  </span>
                </div>

                <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-1">
                  {inProgressList.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      members={activeWorkspace?.members || []}
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onDragEnd={(e) => { handleDragEnd(e); broadcastEvent({ event: 'drag_end', task_id: task.id }); }}
                      onClick={() => navigate(`/workspaces/${workspaceSlug}/${projectSlug}/tasks/${task.id}`)}
                      overdue={isOverdue(task.due_date, task.status)}
                      isAdmin={role.isAdmin}
                      currentUserId={user?.id}
                      activeDrags={activeDrags}
                    />
                  ))}
                  {inProgressList.length === 0 && (
                    <div className="py-8 text-center text-xs text-gray-400 italic">No tasks here</div>
                  )}
                </div>
              </div>
            )}

            {/* DONE COLUMN */}
            {(statusFilter === 'all' || statusFilter === 'done') && (
              <div
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, 'done')}
                className="bg-slate-50 border border-gray-200/60 rounded-2xl p-4 flex flex-col flex-1 min-w-[320px] max-w-[500px] shrink-0 select-none min-h-[500px]"
              >
                <div className="flex items-center justify-between pb-3 border-b border-gray-200/50 mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
                    <h4 className="text-sm font-extrabold text-gray-900 tracking-tight">Done</h4>
                  </div>
                  <span className="px-2 py-0.5 bg-green-100 text-green-800 text-[10px] font-black rounded-full">
                    {doneList.length}
                  </span>
                </div>

                <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-1">
                  {doneList.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      members={activeWorkspace?.members || []}
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onDragEnd={(e) => { handleDragEnd(e); broadcastEvent({ event: 'drag_end', task_id: task.id }); }}
                      onClick={() => navigate(`/workspaces/${workspaceSlug}/${projectSlug}/tasks/${task.id}`)}
                      overdue={isOverdue(task.due_date, task.status)}
                      isAdmin={role.isAdmin}
                      currentUserId={user?.id}
                      activeDrags={activeDrags}
                    />
                  ))}
                  {doneList.length === 0 && (
                    <div className="py-8 text-center text-xs text-gray-400 italic">No tasks here</div>
                  )}
                </div>
              </div>
            )}

          </div>
        </>
      )}

      {activeTab === 'analytics' && renderAnalytics()}
      {activeTab === 'audit_log' && renderAuditLog()}

      {/* Task Creation Modal */}
      <Modal isOpen={isNewTaskOpen} onClose={() => { setIsNewTaskOpen(false); setFormErrors({}); }} title="Create New Task">
        <form onSubmit={handleCreateTask} className="space-y-4 font-sans">
          <div>
            <label className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-1">
              Task Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Implement API route"
              value={newTitle}
              onChange={(e) => {
                if (e.target.value.length <= 100) setNewTitle(e.target.value);
              }}
              maxLength={100}
              className={`w-full px-5 py-3 rounded-full border focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 text-sm font-medium transition-all ${
                formErrors.title ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-fuchsia-500'
              }`}
            />
            {formErrors.title && <p className="text-[10px] font-bold text-red-500 mt-1">{formErrors.title}</p>}
            {newTitle.length >= 100 && <p className="text-[10px] text-amber-500 mt-1 font-bold ml-2">Character limit reached (100).</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-1">
                Assignee <span className="text-red-500">*</span>
              </label>
              <select
                value={newAssignee}
                onChange={(e) => setNewAssignee(e.target.value)}
                className={`w-full px-4 py-2.5 rounded-full border focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 bg-white text-xs font-semibold ${
                  formErrors.assignee ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-fuchsia-500'
                }`}
              >
                <option value="">Select Assignee</option>
                {activeWorkspace?.members.filter(m => (m.status || '').toLowerCase() === 'accepted').map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              {formErrors.assignee && <p className="text-[10px] font-bold text-red-500 mt-1">{formErrors.assignee}</p>}
            </div>
            <div>
              <label className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-1">
                Due Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className={`w-full px-4 py-2.5 rounded-full border focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 text-xs font-semibold ${
                  formErrors.dueDate ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-fuchsia-500'
                }`}
              />
              {formErrors.dueDate && <p className="text-[10px] font-bold text-red-500 mt-1">{formErrors.dueDate}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-1">
                Priority Level <span className="text-red-500">*</span>
              </label>
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value)}
                className={`w-full px-4 py-2.5 rounded-full border focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 bg-white text-xs font-semibold ${
                  formErrors.priority ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-fuchsia-500'
                }`}
              >
                <option value="1">1 - Low</option>
                <option value="2">2 - Medium-Low</option>
                <option value="3">3 - Medium</option>
                <option value="4">4 - High</option>
                <option value="5">5 - Critical</option>
              </select>
              {formErrors.priority && <p className="text-[10px] font-bold text-red-500 mt-1">{formErrors.priority}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-1">
              Description
            </label>
            <textarea
              placeholder="Provide context and notes for this task..."
              rows={3}
              value={newDesc}
              onChange={(e) => {
                if (e.target.value.length <= 2000) setNewDesc(e.target.value);
              }}
              maxLength={2000}
              className="w-full px-5 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 text-sm font-medium transition-all resize-none"
            />
            {newDesc.length >= 2000 && <p className="text-[10px] text-amber-500 mt-1 font-bold ml-2">Character limit reached (2000).</p>}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <PillButton variant="ghost" onClick={() => { setIsNewTaskOpen(false); setFormErrors({}); }}>
              Cancel
            </PillButton>
            <PillButton type="submit" variant="primary">
              Create Task
            </PillButton>
          </div>
        </form>
      </Modal>

      {/* Smart Assign Modal (Balanced creation) */}
      <Modal isOpen={isSmartAssignOpen} onClose={() => setIsSmartAssignOpen(false)} title="Smart Assign New Task">
        <form onSubmit={handleSmartAssign} className="space-y-4 font-sans">
          <div className="p-3 bg-fuchsia-50 border border-fuchsia-100 rounded-2xl text-xs text-fuchsia-800 leading-relaxed font-semibold">
            ✨ Orbit Smart Assign automatically routes the task to the workspace member with the lowest workload urgency.
          </div>
          <div>
            <label className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-1">
              Task Title
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Complete security audit"
              value={smartTitle}
              onChange={(e) => {
                if (e.target.value.length <= 100) setSmartTitle(e.target.value);
              }}
              maxLength={100}
              className="w-full px-5 py-3 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 text-sm font-medium transition-all"
            />
            {smartTitle.length >= 100 && <p className="text-[10px] text-amber-500 mt-1 font-bold ml-2">Character limit reached (100).</p>}
          </div>
          <div>
            <label className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-1">
              Due Date
            </label>
            <input
              type="date"
              value={smartDueDate}
              onChange={(e) => setSmartDueDate(e.target.value)}
              className="w-full px-4 py-2.5 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 text-xs font-semibold"
            />
          </div>
          <div>
            <label className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-1">
              Description
            </label>
            <textarea
              placeholder="Scope of work..."
              rows={3}
              value={smartDesc}
              onChange={(e) => {
                if (e.target.value.length <= 2000) setSmartDesc(e.target.value);
              }}
              maxLength={2000}
              className="w-full px-5 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 text-sm font-medium transition-all resize-none"
            />
            {smartDesc.length >= 2000 && <p className="text-[10px] text-amber-500 mt-1 font-bold ml-2">Character limit reached (2000).</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <PillButton variant="ghost" onClick={() => setIsSmartAssignOpen(false)}>
              Cancel
            </PillButton>
            <PillButton type="submit" variant="primary">
              Auto Route Task
            </PillButton>
          </div>
        </form>
      </Modal>

      {/* Edit Project Modal */}
      <Modal isOpen={isEditProjectOpen} onClose={() => setIsEditProjectOpen(false)} title="Edit Project">
        <form onSubmit={handleEditProject} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-extrabold text-gray-700 uppercase tracking-wider">Project Name</label>
            <input
              type="text"
              placeholder="e.g. Q3 Marketing Campaign"
              value={editProjectTitle}
              onChange={(e) => {
                if (e.target.value.length <= 100) setEditProjectTitle(e.target.value);
              }}
              maxLength={100}
              className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-sm font-semibold text-gray-800 transition-all"
            />
            {editProjectTitle.length >= 100 && <p className="text-[10px] text-amber-500 mt-1 font-bold ml-2">Character limit reached (100).</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-extrabold text-gray-700 uppercase tracking-wider">Description <span className="text-gray-400 font-medium">(Optional)</span></label>
            <textarea
              placeholder="Brief overview of this project's goals..."
              value={editProjectDesc}
              onChange={(e) => {
                if (e.target.value.length <= 1000) setEditProjectDesc(e.target.value);
              }}
              maxLength={1000}
              rows={3}
              className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-sm font-semibold text-gray-800 transition-all resize-none"
            />
            {editProjectDesc.length >= 1000 && <p className="text-[10px] text-amber-500 mt-1 font-bold ml-2">Character limit reached (1000).</p>}
          </div>
          
          <div className="pt-4 flex justify-end">
            <PillButton 
              type="submit" 
              variant="primary"
              disabled={editProjectTitle.trim() === (project?.name || '') && editProjectDesc.trim() === (project?.description || '')}
            >
              Save Changes
            </PillButton>
          </div>
        </form>
      </Modal>

      {/* Delete Project Modal */}
      <Modal isOpen={isDeleteProjectOpen} onClose={() => setIsDeleteProjectOpen(false)} title="Delete Project">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Are you sure you want to permanently delete this project? This will erase all tasks and cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <PillButton variant="secondary" onClick={() => setIsDeleteProjectOpen(false)}>Cancel</PillButton>
            <PillButton variant="danger" onClick={handleDeleteProject}>Delete Project</PillButton>
          </div>
        </div>
      </Modal>

      {/* Nested Slideover Drawer */}
      <Outlet />

    </div>
  );
}

function TaskCard({ task, members, onDragStart, onDragEnd, onClick, overdue, isAdmin, currentUserId, activeDrags = {} }) {
  const assignee = members.find(m => m.id === task.assignee_id);
  const cleanDueDate = task.due_date ? task.due_date.substring(0, 10) : '';

  const isCreator = task.assignor_id === currentUserId;
  const isAssignee = task.assignee_id === currentUserId;
  const draggedByOther = activeDrags[task.id];

  let canEditStatus = false;
  if (isCreator || isAdmin || isAssignee) {
    canEditStatus = true;
  }
  
  let isLocked = !canEditStatus;
  if (canEditStatus && task.status === 'done') {
    if (isCreator || isAdmin) {
       isLocked = false;
    } else {
       isLocked = true;
    }
  }

  // Force lock if someone else is actively dragging this task
  if (draggedByOther) {
    isLocked = true;
  }

  return (
    <div
      draggable={!isLocked}
      onDragStart={isLocked ? undefined : onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`relative rounded-2xl border p-5 shadow-xs transition-all duration-200 text-left flex flex-col justify-between min-h-[120px] select-none ${
        draggedByOther 
          ? 'bg-fuchsia-50 border-fuchsia-400 ring-2 ring-fuchsia-300 ring-opacity-50 opacity-90'
          : isLocked 
            ? 'bg-gray-50/70 border-dashed border-gray-200 cursor-not-allowed opacity-80' 
            : 'bg-white border-gray-200 hover:shadow-md hover:-translate-y-1 cursor-grab active:cursor-grabbing'
      }`}
    >
      {draggedByOther && (
        <div className="absolute -top-3 -right-2 bg-fuchsia-500 text-white text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shadow-sm animate-pulse flex items-center gap-1 z-10">
          <Activity size={10} />
          {draggedByOther.userName} is moving...
        </div>
      )}

      <div>
        <div className="flex items-start justify-between gap-2">
          <h5 className="text-xs font-extrabold text-gray-900 tracking-tight line-clamp-2 leading-tight">
            {task.title}
          </h5>
          {isLocked && !draggedByOther && (
            <Lock size={12} className="text-amber-500 shrink-0 mt-0.5" title="Locked (Non-admin or not assigned to you)" />
          )}
        </div>
        <p className="text-[11px] text-gray-400 line-clamp-1 mt-1 font-medium">
          {task.description || 'No description.'}
        </p>
      </div>

      <div className="mt-4 border-t border-gray-50 pt-3 flex items-center justify-between">
        
        {cleanDueDate ? (
          <div className={`flex items-center gap-1 text-[10px] font-bold ${overdue ? 'text-red-500 font-extrabold' : 'text-gray-400'}`}>
            <Calendar size={12} />
            <span>{cleanDueDate}</span>
          </div>
        ) : (
          <div className="text-[10px] text-gray-300 italic">No date</div>
        )}

        <div className="flex items-center gap-2">
          <StatusBadge status={task.status} />
          {assignee ? (
            <Avatar initials={assignee.initials} name={assignee.name} size="xs" />
          ) : (
            <div className="w-6.5 h-6.5 rounded-full border border-dashed border-gray-300 flex items-center justify-center text-[9px] text-gray-400 font-bold" title="Unassigned">
              --
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
