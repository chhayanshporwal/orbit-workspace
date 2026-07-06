import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { slugify } from '../utils/slugify';
import PillButton from '../components/PillButton';
import Avatar from '../components/Avatar';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import { showToast } from '../components/Toast';
import {
  Folder,
  Users,
  BarChart3,
  Plus,
  Trash2,
  UserPlus,
  AlertTriangle,
  CheckCircle,
  Clock,
  Settings,
  Activity
} from 'lucide-react';

const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const getStatusBadge = (status) => {
  const s = (status || '').toLowerCase();
  if (s === 'accepted') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
        Active
      </span>
    );
  }
  if (s === 'invited') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
        Invited
      </span>
    );
  }
  if (s === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
        Rejected
      </span>
    );
  }
  return null;
};

const getTimelineLog = (member) => {
  const s = (member.status || '').toLowerCase();
  return (
    <div className="flex flex-col gap-0.5 text-[10px] text-gray-500 font-medium">
      {member.invitedAt && (
        <span className="flex items-center gap-1">
          <span className="text-gray-400">Invited:</span>
          {formatDate(member.invitedAt)}
        </span>
      )}
      {s === 'accepted' && member.joinedAt && (
        <span className="flex items-center gap-1 text-green-600 font-bold">
          <span>Joined:</span>
          {formatDate(member.joinedAt)}
        </span>
      )}
    </div>
  );
};

export default function WorkspaceDetail() {
  const { workspaceSlug } = useParams();
  const navigate = useNavigate();
  const {
    workspaces,
    projects,
    tasks,
    allTasks,
    role,
    inviteMember,
    updateMemberRole,
    removeMember,
    createProject,
    deleteWorkspace,
    updateWorkspace,
    setActiveWorkspaceId,
    setActiveProjectId
  } = useWorkspace();
  const { user } = useAuth();

  // Resolve slug to actual workspace
  const ws = workspaces.find(w => slugify(w.name) === workspaceSlug) || workspaces[0];

  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'projects'); // 'projects', 'members', 'analytics', 'audit_log'

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
  const [isProjModalOpen, setIsProjModalOpen] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');

  // Member invite inputs
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Viewer');

  const [newWsName, setNewWsName] = useState('');
  const [newWsDesc, setNewWsDesc] = useState('');

  useEffect(() => {
    if (ws) {
      setNewWsName(ws.name);
      setNewWsDesc(ws.description || '');
    }
  }, [ws]);

  const handleRenameWorkspace = async (e) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    await updateWorkspace(ws.id, newWsName.trim(), newWsDesc.trim());
    // Navigate to the new slug so URL stays in sync with the renamed workspace
    navigate(`/workspaces/${slugify(newWsName.trim())}/dashboard`);
  };

  const [isDeleteWorkspaceModalOpen, setIsDeleteWorkspaceModalOpen] = useState(false);
  const [isLeaveWorkspaceModalOpen, setIsLeaveWorkspaceModalOpen] = useState(false);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [memberToChangeRole, setMemberToChangeRole] = useState(null);
  const [newRole, setNewRole] = useState('');
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState(null);
  const [removeReason, setRemoveReason] = useState('');

  const handleDeleteWorkspace = async () => {
    await deleteWorkspace(ws.id);
    navigate("/workspaces");
    setIsDeleteWorkspaceModalOpen(false);
  };

  const handleLeaveWorkspace = async () => {
    try {
      await api.post(`/workspaces/${ws.id}/leave-requests`);
      showToast('success', "Leave request successfully submitted to workspace admins.");
      navigate('/workspaces');
    } catch (e) {
      showToast('error', e.message);
    }
    setIsLeaveWorkspaceModalOpen(false);
  };

  // Analytics State
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  useEffect(() => {
    if (ws) {
      setActiveWorkspaceId(ws.id);
    }
  }, [ws, setActiveWorkspaceId]);

  // Fetch Analytics from API when the tab changes to 'analytics'
  useEffect(() => {
    if (activeTab === 'analytics' && ws) {
      setAnalyticsLoading(true);
      api.get(`/workspaces/${ws.id}/analytics`)
        .then(data => {
          setAnalytics(data);
          setAnalyticsLoading(false);
        })
        .catch(err => {
          console.error(err);
          setAnalyticsLoading(false);
        });
    }
  }, [activeTab, ws]);

  const [workspaceLogs, setWorkspaceLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const { updateUserProjectView, userProjectViews } = useWorkspace();

  const [initialLastViewed, setInitialLastViewed] = useState(null);

  useEffect(() => {
    if (activeTab === 'audit_log' && ws) {
      setLogsLoading(true);
      api.get(`/workspaces/${ws.id}/audit-logs`)
        .then(data => {
          setWorkspaceLogs(data);
          setLogsLoading(false);
          setInitialLastViewed(userProjectViews?.[`ws-${ws.id}`] || null);
          // Mark workspace logs as read by using project_id = null representation, e.g., 'ws-' + ws.id
          updateUserProjectView(`ws-${ws.id}`);
        })
        .catch(err => {
          console.error(err);
          setLogsLoading(false);
        });
    }
  }, [activeTab, ws]);

  if (!ws) {
    return <div className="p-8 text-center text-gray-500 font-sans">Workspace not found</div>;
  }

  const wsProjects = projects.filter(p => p.workspace_id === ws.id);
  const wsTasks = allTasks.filter(t => wsProjects.some(p => p.id === t.project_id));



  const handleRemoveMemberClick = (memberId) => {
    if (memberId === user?.id) {
      setIsLeaveWorkspaceModalOpen(true);
    } else {
      setMemberToRemove(memberId);
      setRemoveReason('');
      setIsRemoveModalOpen(true);
    }
  };

  const handleRemoveSubmit = (e) => {
    e.preventDefault();
    if (!memberToRemove) return;
    removeMember(ws.id, memberToRemove, removeReason);
    setIsRemoveModalOpen(false);
    setMemberToRemove(null);
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    const cleanName = projName.trim();
    const cleanDesc = projDesc.trim();
    if (!cleanName) return;
    const proj = await createProject(ws.id, cleanName, cleanDesc);
    setProjName('');
    setProjDesc('');
    setIsProjModalOpen(false);
    if (proj) {
      navigate(`/workspaces/${workspaceSlug}/${slugify(proj.name)}`);
    }
  };

  const handleInvite = (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    inviteMember(ws.id, inviteEmail, inviteRole);
    setInviteEmail('');
    setInviteRole('Viewer');
  };

  // Pie Chart SVG wedge helper
  const drawPieChart = () => {
    if (!analytics) return null;
    const counts = analytics.status_counts || {};
    // Backend returns case-sensitive keys: "To Do", "In Progress", "Done"
    const todo = counts['To Do'] || counts['todo'] || 0;
    const inprogress = counts['In Progress'] || counts['inprogress'] || 0;
    const done = counts['Done'] || counts['done'] || 0;
    
    const total = todo + inprogress + done;
    if (total === 0) {
      return (
        <div className="w-48 h-48 rounded-full border-4 border-dashed border-gray-100 flex items-center justify-center text-center text-xs text-gray-400 p-4">
          No tasks found in workspace.
        </div>
      );
    }

    const todoPct = (todo / total) * 100;
    const ipPct = (inprogress / total) * 100;
    const donePct = (done / total) * 100;

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

    return (
      <div className="flex flex-col md:flex-row items-center justify-around gap-8">
        <div className="relative w-48 h-48">
          <svg viewBox="-1.1 -1.1 2.2 2.2" className="w-full h-full -rotate-90">
            {todoPct > 0 && <path d={todoPath} fill="#3b82f6" className="hover:opacity-95" />}
            {ipPct > 0 && <path d={ipPath} fill="#f59e0b" className="hover:opacity-95" />}
            {donePct > 0 && <path d={donePath} fill="#22c55e" className="hover:opacity-95" />}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center flex-col bg-white rounded-full w-24 h-24 m-auto shadow-inner border border-gray-50">
            <span className="text-[10px] font-bold text-gray-400 uppercase">Success Rate</span>
            <span className="text-lg font-black text-gray-900">
              {Math.round(donePct)}%
            </span>
          </div>
        </div>

        <div className="space-y-4 w-full md:w-1/2">
          <div className="flex items-center justify-between p-3 border border-gray-100 rounded-xl bg-gray-50/30">
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full bg-blue-500"></span>
              <span className="text-xs font-bold text-gray-700">To Do</span>
            </div>
            <span className="text-xs font-black text-gray-900">{todo} ({Math.round(todoPct)}%)</span>
          </div>

          <div className="flex items-center justify-between p-3 border border-gray-100 rounded-xl bg-gray-50/30">
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full bg-amber-500"></span>
              <span className="text-xs font-bold text-gray-700">In Progress</span>
            </div>
            <span className="text-xs font-black text-gray-900">{inprogress} ({Math.round(ipPct)}%)</span>
          </div>

          <div className="flex items-center justify-between p-3 border border-gray-100 rounded-xl bg-gray-50/30">
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full bg-green-500"></span>
              <span className="text-xs font-bold text-gray-700">Done</span>
            </div>
            <span className="text-xs font-black text-gray-900">{done} ({Math.round(donePct)}%)</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="font-sans min-h-screen">
      
      {/* Workspace Header */}
      <div className="bg-gray-50/50 border-b border-gray-200 px-8 py-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-gray-900">
              {ws.name}
            </h2>
            {ws.description && (
              <p className="text-sm font-semibold text-gray-700 mt-2 max-w-3xl leading-relaxed">
                {ws.description}
              </p>
            )}
            <p className="text-xs text-gray-500 mt-2 max-w-2xl leading-relaxed">
              Workspace ID: {ws.id} • Connects automatically to postgres models.
            </p>
          </div>
          {!role.isAdmin && (
            <PillButton
              variant="secondary"
              size="sm"
              onClick={handleLeaveWorkspace}
              className="flex items-center gap-1 self-start md:self-center"
            >
              Leave Workspace
            </PillButton>
          )}
        </div>

        {/* Tab Controls */}
        <div className="flex gap-4 mt-6 overflow-x-auto whitespace-nowrap hide-scrollbar pb-1">
          <button
            onClick={() => handleTabChange('projects')}
            className={`flex shrink-0 items-center gap-1.5 px-4 py-2 border-b-2 text-xs font-extrabold transition-all ${
              activeTab === 'projects'
                ? 'border-fuchsia-600 text-fuchsia-600'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <Folder size={14} /> Projects
          </button>
          <button
            onClick={() => handleTabChange('members')}
            className={`flex shrink-0 items-center gap-1.5 px-4 py-2 border-b-2 text-xs font-extrabold transition-all ${
              activeTab === 'members'
                ? 'border-fuchsia-600 text-fuchsia-600'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <Users size={14} /> Members
          </button>
          <button
            onClick={() => handleTabChange('analytics')}
            className={`flex shrink-0 items-center gap-1.5 px-4 py-2 border-b-2 text-xs font-extrabold transition-all ${
              activeTab === 'analytics'
                ? 'border-fuchsia-600 text-fuchsia-600'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <BarChart3 size={14} /> Analytics
          </button>
          <button
            onClick={() => handleTabChange('audit_log')}
            className={`flex shrink-0 items-center gap-1.5 px-4 py-2 border-b-2 text-xs font-extrabold transition-all ${
              activeTab === 'audit_log'
                ? 'border-fuchsia-600 text-fuchsia-600'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <Activity size={14} /> Audit Log
          </button>
          {role.isAdmin && (
            <button
              onClick={() => handleTabChange('settings')}
              className={`flex shrink-0 items-center gap-1.5 px-4 py-2 border-b-2 text-xs font-extrabold transition-all ${
                activeTab === 'settings'
                  ? 'border-fuchsia-600 text-fuchsia-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Settings size={14} /> Settings
            </button>
          )}
        </div>
      </div>

      {/* Main Tab Area */}
      <div className="p-8">
        
        {/* Projects Tab */}
        {activeTab === 'projects' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold tracking-tight text-gray-900">
                Workspace Projects ({wsProjects.length})
              </h3>
              {role.isAdmin && (
                <PillButton
                  variant="primary"
                  size="sm"
                  onClick={() => setIsProjModalOpen(true)}
                  className="flex items-center gap-1"
                >
                  <Plus size={14} /> New Project
                </PillButton>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {wsProjects.map((proj) => (
                <div
                  key={proj.id}
                  onClick={() => {
                    setActiveProjectId(proj.id);
                    navigate(`/workspaces/${slugify(ws.name)}/${slugify(proj.name)}`);
                  }}
                  className="border border-gray-200 rounded-2xl p-6 hover:shadow-md hover:-translate-y-1 transition-all duration-200 bg-white cursor-pointer group"
                >
                  <h4 className="text-base font-extrabold tracking-tight text-gray-900 group-hover:text-fuchsia-600 transition-colors">
                    {proj.name}
                  </h4>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                    {proj.description || 'No description provided.'}
                  </p>
                  <div className="mt-6 border-t border-gray-50 pt-4 flex items-center justify-between text-[11px] font-bold text-gray-400">
                    <span>
                      {proj.createdAt ? `Created ${formatDate(proj.createdAt)}` : `Project ID: ${proj.id}`}
                    </span>
                    <span className="text-fuchsia-600 group-hover:underline flex items-center gap-0.5">
                      Open Board &rarr;
                    </span>
                  </div>
                </div>
              ))}
              {wsProjects.length === 0 && (
                <div className="col-span-full border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center text-gray-400">
                  No projects in this workspace yet.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Members Tab */}
        {activeTab === 'members' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-extrabold tracking-tight text-gray-900">
                  Workspace Team
                </h3>
                <p className="text-xs text-gray-500">
                  {role.isAdmin ? 'Invite team members and adjust workspace access roles.' : 'View workspace member roles.'}
                </p>
              </div>

              {role.isAdmin && (
                <form onSubmit={handleInvite} className="flex gap-2 w-full md:w-auto">
                  <input
                    type="email"
                    required
                    placeholder="teammate@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="px-4 py-2 text-xs rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 w-full md:w-56 font-semibold"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="px-3 py-2 text-xs rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 bg-white font-semibold"
                  >
                    <option value="Admin">Admin</option>
                    <option value="Editor">Editor</option>
                    <option value="Viewer">Viewer</option>
                  </select>
                  <PillButton type="submit" variant="primary" size="sm" className="shrink-0 flex items-center gap-1">
                    <UserPlus size={12} /> Invite
                  </PillButton>
                </form>
              )}
            </div>

            <div className="overflow-x-auto border border-gray-200 rounded-2xl bg-white shadow-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-6 py-3 text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Teammate</th>
                    <th className="px-6 py-3 text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Email</th>
                    <th className="px-6 py-3 text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Status</th>
                    <th className="px-6 py-3 text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Timeline</th>
                    <th className="px-6 py-3 text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Workspace Role</th>
                    {role.isAdmin && <th className="px-6 py-3 text-[10px] uppercase tracking-wider font-extrabold text-gray-400 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {ws.members?.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50/50">
                      <td className="px-6 py-4 flex items-center gap-2.5 font-semibold text-gray-900">
                        <Avatar initials={member.initials} name={member.name} size="sm" />
                        {member.name}
                      </td>
                      <td className="px-6 py-4 text-gray-500 font-medium">{member.email}</td>
                      <td className="px-6 py-4">{getStatusBadge(member.status)}</td>
                      <td className="px-6 py-4">{getTimelineLog(member)}</td>
                      <td className="px-6 py-4">
                        {role.isAdmin ? (
                          <select
                            value={member.role}
                            onChange={(e) => {
                              setMemberToChangeRole(member.id);
                              setNewRole(e.target.value);
                              setIsRoleModalOpen(true);
                            }}
                            className="bg-white border border-gray-200 text-xs rounded-full px-3 py-1 font-semibold focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20"
                          >
                            <option value="Admin">Admin</option>
                            <option value="Editor">Editor</option>
                            <option value="Viewer">Viewer</option>
                          </select>
                        ) : (
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                            member.role === 'Admin' ? 'bg-fuchsia-100 text-fuchsia-800' :
                            member.role === 'Editor' ? 'bg-blue-100 text-blue-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {member.role}
                          </span>
                        )}
                      </td>
                      {role.isAdmin && (
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleRemoveMemberClick(member.id)}
                            className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                            title="Remove Member"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="space-y-8">
            {analyticsLoading ? (
              <div className="text-center text-xs font-semibold text-gray-400 py-12">Loading Analytics...</div>
            ) : analytics ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="border border-gray-200 rounded-2xl p-6 bg-white flex items-center gap-4 shadow-xs">
                    <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <Folder size={18} />
                    </div>
                    <div>
                      <div className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Total Workspace Tasks</div>
                      <div className="text-2xl font-black text-gray-900">{analytics.total_tasks}</div>
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-2xl p-6 bg-white flex items-center gap-4 shadow-xs">
                    <div className="w-10 h-10 rounded-full bg-green-50 text-green-600 flex items-center justify-center shrink-0">
                      <CheckCircle size={18} />
                    </div>
                    <div>
                      <div className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Completed Tasks</div>
                      <div className="text-2xl font-black text-gray-900">
                        {analytics.status_counts?.['Done'] || analytics.status_counts?.['done'] || 0}
                      </div>
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-2xl p-6 bg-white flex items-center gap-4 shadow-xs">
                    <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                      <Clock size={18} />
                    </div>
                    <div>
                      <div className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Overdue Tasks</div>
                      <div className="text-2xl font-black text-red-600">{analytics.overdue_tasks}</div>
                    </div>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-2xl p-6 bg-white shadow-xs">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-6">
                    Tasks by Status
                  </h4>
                  {drawPieChart()}
                </div>

                <div className="border border-gray-200 rounded-2xl p-6 bg-white shadow-xs">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-4">
                    Bottleneck Users
                  </h4>
                  <div className="divide-y divide-gray-100">
                    {analytics.bottlenecks?.map((bn, idx) => (
                      <div key={idx} className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          <Avatar initials={bn.user_email.substring(0,2).toUpperCase()} name={bn.user_email} size="sm" />
                          <div>
                            <div className="text-xs font-extrabold text-gray-900">{bn.user_email}</div>
                          </div>
                        </div>
                        <span className="px-3 py-1 bg-red-50 text-red-700 rounded-full text-xs font-bold border border-red-100 flex items-center gap-1">
                          <AlertTriangle size={12} /> {bn.overdue_count} Overdue
                        </span>
                      </div>
                    ))}
                    {(!analytics.bottlenecks || analytics.bottlenecks.length === 0) && (
                      <div className="py-4 text-center text-xs text-gray-400 italic">
                        🎉 No bottlenecks detected. Excellent work!
                      </div>
                    )}
                  </div>
                </div>

                {/* Spreadsheet Drill-Down Table */}
                <div className="border border-gray-200 rounded-2xl p-6 bg-white shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-400">
                      Workspace Tasks Drill-Down
                    </h4>
                    <span className="px-2.5 py-0.5 bg-gray-100 text-gray-700 text-[10px] font-black rounded-full">
                      {wsTasks.length} Total
                    </span>
                  </div>
                  
                  <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase font-extrabold text-gray-400">
                          <th className="px-4 py-3">Task Title</th>
                          <th className="px-4 py-3">Project</th>
                          <th className="px-4 py-3">Assignee</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Due Date</th>
                          {role.isAdmin && <th className="px-4 py-3 text-right">Admin Audit Info</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-xs font-medium text-gray-700">
                        {wsTasks.map((t) => {
                          const assignee = ws.members?.find(m => m.id === t.assignee_id);
                          return (
                            <tr key={t.id} className="hover:bg-gray-50/50">
                              <td className="px-4 py-3 font-semibold text-gray-900">{t.title}</td>
                              <td className="px-4 py-3 text-gray-500">{t.projectName || 'Board'}</td>
                              <td className="px-4 py-3">
                                {assignee ? (
                                  <div className="flex items-center gap-1.5">
                                    <Avatar initials={assignee.initials} name={assignee.name} size="xs" />
                                    <span>{assignee.name}</span>
                                  </div>
                                ) : (
                                  <span className="text-gray-400 italic">Unassigned</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge status={t.status} />
                              </td>
                              <td className="px-4 py-3 text-gray-500">
                                {t.due_date ? t.due_date.substring(0, 10) : 'No due date'}
                              </td>
                              {role.isAdmin && (
                                <td className="px-4 py-3 text-right text-[10px] text-amber-600 font-bold">
                                  ID: {t.id} • Prio: {t.priority_level}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                        {wsTasks.length === 0 && (
                          <tr>
                            <td colSpan={role.isAdmin ? 6 : 5} className="px-4 py-8 text-center text-gray-400 italic">
                              No tasks found in this workspace.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center text-xs text-gray-400 py-12">Failed to load analytics.</div>
            )}
          </div>
        )}

        {/* Audit Log Tab */}
        {activeTab === 'audit_log' && (
          <div className="bg-white border border-gray-200 rounded-3xl p-8 shadow-xs max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                <Activity size={18} className="text-fuchsia-500" />
                Workspace Audit Log
              </h2>
            </div>
            
            <div className="space-y-4">
              {logsLoading ? (
                <div className="flex justify-center p-8"><span className="animate-pulse w-6 h-6 rounded-full bg-fuchsia-300"></span></div>
              ) : workspaceLogs.filter(log => !log.project_id).length > 0 ? (
                (() => {
                  const filteredLogs = workspaceLogs.filter(log => !log.project_id);
                  const renderedLogs = [];
                  let separatorInjected = false;
                  
                  filteredLogs.forEach(log => {
                    if (initialLastViewed && new Date(log.created_at) <= new Date(initialLastViewed) && !separatorInjected) {
                      if (renderedLogs.length > 0) {
                        renderedLogs.push({ isSeparator: true, id: 'separator' });
                      }
                      separatorInjected = true;
                    }
                    renderedLogs.push(log);
                  });
                  
                  return renderedLogs.map(log => {
                    if (log.isSeparator) {
                      return (
                        <div key={log.id} className="relative py-4">
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
                    return (
                      <div key={log.id} className="flex gap-4 p-4 rounded-2xl hover:bg-gray-50/50 transition-colors border border-transparent hover:border-gray-100 group">
                        <div className={`mt-1 w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-purple-50`}>
                          <Activity size={14} className="text-purple-500" />
                        </div>
                        <div className="flex-1 min-w-0 pt-1">
                          <div className="flex items-center justify-between gap-4 mb-1">
                            <p className="text-xs font-black text-gray-900 uppercase tracking-wider truncate">
                              {log.action.replace(/_/g, ' ')}
                            </p>
                            <span className="text-[10px] font-bold text-gray-400 shrink-0 whitespace-nowrap bg-gray-100 px-2 py-0.5 rounded-full">
                              {new Date(log.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 font-medium leading-relaxed">
                            {log.details}
                          </p>
                          {log.user && (
                            <div className="flex items-center gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Action by:</span>
                              <div className="flex items-center gap-1.5 bg-white border border-gray-200 px-2 py-0.5 rounded-full shadow-sm">
                                <Avatar name={log.user.name || log.user.email} size="xs" />
                                <span className="text-[10px] font-bold text-gray-700">{log.user.name || log.user.email}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()
              ) : (
                <div className="text-center py-12 text-sm text-gray-500 font-medium italic border-2 border-dashed border-gray-100 rounded-2xl">
                  No workspace-level audit logs available.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && role.isAdmin && (
          <div className="max-w-xl space-y-8 bg-white border border-gray-200 rounded-2xl p-6 shadow-xs text-left">
            <div>
              <h3 className="text-base font-extrabold text-gray-900 tracking-tight">Workspace Settings</h3>
              <p className="text-xs text-gray-500 mt-1">Configure name and delete properties for this workspace.</p>
            </div>

            <form onSubmit={handleRenameWorkspace} className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider block mb-1.5">Workspace Name</label>
                <input
                  type="text"
                  value={newWsName}
                  onChange={(e) => {
                    if (e.target.value.length <= 100) setNewWsName(e.target.value);
                  }}
                  maxLength={100}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-xs font-semibold transition-all"
                  required
                />
                {newWsName.length >= 100 && <p className="text-[10px] text-amber-500 mt-1 font-bold">Character limit reached (100).</p>}
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider block mb-1.5">Description <span className="text-gray-300 lowercase font-medium">(optional)</span></label>
                <textarea
                  value={newWsDesc}
                  onChange={(e) => {
                    if (e.target.value.length <= 1000) setNewWsDesc(e.target.value);
                  }}
                  maxLength={1000}
                  rows={3}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 transition-all font-medium resize-none"
                />
                {newWsDesc.length >= 1000 && <p className="text-[10px] text-amber-500 mt-1 font-bold">Character limit reached (1000).</p>}
              </div>
              <button
                type="submit"
                disabled={newWsName.trim() === ws.name && newWsDesc.trim() === (ws.description || '')}
                className="py-2 px-4 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-xs"
              >
                Save Changes
              </button>
            </form>

            <div className="border-t border-gray-100 pt-6">
              <h4 className="text-sm font-extrabold text-red-600 tracking-tight">Danger Zone</h4>
              <p className="text-xs text-gray-500 mt-1">Permanently delete this workspace and all associated projects and tasks.</p>
              
              <button
                type="button"
                onClick={() => setIsDeleteWorkspaceModalOpen(true)}
                className="mt-4 py-2 px-4 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-bold transition-all border border-red-100"
              >
                Delete Workspace
              </button>
            </div>
          </div>
        )}

      </div>

      {/* New Project Modal */}
      <Modal isOpen={isProjModalOpen} onClose={() => setIsProjModalOpen(false)} title="Create New Project">
        <form onSubmit={handleCreateProject} className="space-y-4">
          <div>
            <label className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-1">
              Project Name
            </label>
            <input
              type="text"
              required
              value={projName}
              onChange={(e) => {
                if (e.target.value.length <= 100) setProjName(e.target.value);
              }}
              maxLength={100}
              placeholder="e.g. Android Build"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-xs font-semibold transition-all"
            />
            {projName.length >= 100 && <p className="text-[10px] text-amber-500 mt-1 font-bold">Character limit reached (100).</p>}
          </div>
          <div>
            <label className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-1">
              Description
            </label>
            <textarea
              value={projDesc}
              onChange={(e) => {
                if (e.target.value.length <= 1000) setProjDesc(e.target.value);
              }}
              maxLength={1000}
              placeholder="Detail the scope of this project board..."
              rows={3}
              className="w-full px-5 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-sm font-medium transition-all resize-none"
            />
            {projDesc.length >= 1000 && <p className="text-[10px] text-amber-500 mt-1 font-bold">Character limit reached (1000).</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <PillButton variant="ghost" onClick={() => setIsProjModalOpen(false)}>
              Cancel
            </PillButton>
            <PillButton type="submit" variant="primary">
              Create
            </PillButton>
          </div>
        </form>
      </Modal>

      {/* Delete Workspace Modal */}
      <Modal
        isOpen={isDeleteWorkspaceModalOpen}
        onClose={() => setIsDeleteWorkspaceModalOpen(false)}
        title="Delete Workspace"
      >
        <div className="text-sm text-gray-700 mb-6">
          <p className="mb-2">Are you sure you want to permanently delete this workspace?</p>
          <div className="p-3 bg-red-50 text-red-800 rounded-lg border border-red-100 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p className="font-semibold text-xs">This action is permanent and cannot be undone. All projects and tasks will be erased.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setIsDeleteWorkspaceModalOpen(false)}
            className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDeleteWorkspace}
            className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            Delete Workspace
          </button>
        </div>
      </Modal>

      {/* Leave Workspace Modal */}
      <Modal
        isOpen={isLeaveWorkspaceModalOpen}
        onClose={() => setIsLeaveWorkspaceModalOpen(false)}
        title="Leave Workspace"
      >
        <div className="text-sm text-gray-700 mb-6">
          <p>Are you sure you want to leave this workspace? You will lose access to all projects and tasks.</p>
          {!role.isAdmin && (
            <p className="mt-2 text-xs text-gray-500">Your leave request will be sent to the workspace admins for approval.</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setIsLeaveWorkspaceModalOpen(false)}
            className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleLeaveWorkspace}
            className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            Leave Workspace
          </button>
        </div>
      </Modal>

      {/* Remove Member Modal */}
      <Modal
        isOpen={isRemoveModalOpen}
        onClose={() => setIsRemoveModalOpen(false)}
        title="Remove Member"
      >
        <form onSubmit={handleRemoveSubmit}>
          <div className="text-sm text-gray-700 mb-6">
            <p className="mb-4">Are you sure you want to remove this member from the workspace?</p>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">
              Reason <span className="text-gray-300 lowercase font-medium">(optional, will be sent to user)</span>
            </label>
            <textarea
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
              rows={3}
              placeholder="E.g., No longer part of this project"
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 transition-all font-medium resize-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsRemoveModalOpen(false)}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
            >
              Remove Member
            </button>
          </div>
        </form>
      </Modal>

      {/* Change Member Role Modal */}
      <Modal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        title="Change Member Role"
      >
        <div className="text-sm text-gray-700 mb-6">
          <p className="mb-2">Are you sure you want to change this member's role to <strong>{newRole}</strong>?</p>
          <div className="p-3 bg-yellow-50 text-yellow-800 rounded-lg border border-yellow-100 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p className="font-semibold text-xs">Changing a user's role affects their access permissions immediately across the entire workspace.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setIsRoleModalOpen(false)}
            className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              updateMemberRole(ws.id, memberToChangeRole, newRole);
              setIsRoleModalOpen(false);
            }}
            className="px-4 py-2 text-xs font-bold text-white bg-fuchsia-600 hover:bg-fuchsia-700 rounded-lg transition-colors"
          >
            Confirm Change
          </button>
        </div>
      </Modal>

    </div>
  );
}
