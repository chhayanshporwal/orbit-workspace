import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NavLink, Link, Outlet, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useNotifications } from '../hooks/useNotifications';
import { api } from '../utils/api';
import { slugify } from '../utils/slugify';
import Avatar from '../components/Avatar';
import PillButton from '../components/PillButton';
import Modal from '../components/Modal';
import RememberMeDialog from '../components/RememberMeDialog';
import {
  Home,
  CheckSquare,
  Inbox,
  Bell,
  Search,
  ChevronDown,
  LogOut,
  Settings,
  Palette,
  Layers,
  Sparkles,
  Plus,
  Compass,
  UserCheck,
  UserX,
  Shield
} from 'lucide-react';

// Helper to parse JWT token and retrieve the JTI claim
const getJtiFromToken = () => {
  const token = localStorage.getItem('orbit_access_token') || sessionStorage.getItem('orbit_access_token');
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      return payload.jti || null;
    }
  } catch (e) {
    console.error('Failed to parse JWT token', e);
  }
  return null;
};

export default function AppShell() {
  const { user, logout, fetchProfile } = useAuth();
  const {
    workspaces,
    activeWorkspace,
    setActiveWorkspaceId,
    projects,
    allProjects,
    allTasks,
    activeProject,
    setActiveProjectId,
    removeMember,
    deleteWorkspace,
    acceptInvitation,
    rejectInvitation,
  } = useWorkspace();

  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const { workspaceSlug, projectSlug } = useParams();
  const location = useLocation();

  // Sync active states from URL slugs to context
  useEffect(() => {
    if (workspaceSlug && workspaceSlug !== 'dashboard') {
      const ws = workspaces.find(w => slugify(w.name) === workspaceSlug);
      if (ws) setActiveWorkspaceId(ws.id);
    }
    if (projectSlug && projectSlug !== 'dashboard') {
      const activeWs = workspaces.find(w => slugify(w.name) === workspaceSlug);
      const proj = allProjects.find(p =>
        slugify(p.name) === projectSlug && (activeWs ? p.workspace_id === activeWs.id : true)
      );
      if (proj) {
        setActiveProjectId(proj.id);
      } else {
        setActiveProjectId(null);
      }
    } else {
      setActiveProjectId(null);
    }

    if (
      location.pathname === '/workspaces' ||
      location.pathname === '/home' ||
      location.pathname === '/inbox' ||
      location.pathname === '/my-tasks'
    ) {
      setActiveWorkspaceId(null);
      setActiveProjectId(null);
    }
  }, [projectSlug, workspaceSlug, location.pathname, workspaces, allProjects, setActiveWorkspaceId, setActiveProjectId]);

  const [showNotifications, setShowNotifications] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showWorkspaceSelect, setShowWorkspaceSelect] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('orbit_dark_mode') === 'true';
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('orbit_dark_mode', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('orbit_dark_mode', 'false');
    }
  }, [darkMode]);

  // Device Sessions & Password verification states
  const [sessions, setSessions] = useState([]);
  const [currentPassword, setCurrentPassword] = useState('');

  const fetchSessions = useCallback(async () => {
    try {
      const data = await api.get('/users/me/sessions');
      if (data) {
        setSessions(data);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  }, []);

  const handleRevokeSession = async (sessionId) => {
    try {
      await api.post(`/users/me/sessions/${sessionId}/revoke`);
      await fetchSessions();
    } catch (err) {
      alert(err.message || 'Failed to revoke session');
    }
  };

  // Save credentials dialog setup (Instagram-style)
  const [showSaveDeviceDialog, setShowSaveDeviceDialog] = useState(false);
  const { rememberDevice } = useAuth();

  useEffect(() => {
    const isSessionToken = sessionStorage.getItem('orbit_access_token');
    const isLocalToken = localStorage.getItem('orbit_access_token');
    const dismissed = sessionStorage.getItem('orbit_save_device_prompt_dismissed');
    
    if (isSessionToken && !isLocalToken && !dismissed) {
      setShowSaveDeviceDialog(true);
    }
  }, []);

  const handleSaveDevice = async () => {
    const devId = localStorage.getItem('orbit_device_id') || 'unknown_device';
    const devName = navigator.userAgent || 'Unknown Browser';
    await rememberDevice(devId, devName);
    setShowSaveDeviceDialog(false);
  };

  const handleDismissSaveDevice = () => {
    sessionStorage.setItem('orbit_save_device_prompt_dismissed', 'true');
    setShowSaveDeviceDialog(false);
  };

  const searchResults = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return { tasks: [], projects: [], members: [] };

    // 1. Search Tasks
    const matchedTasks = allTasks
      .map(t => {
        let score = 0;
        const titleLower = (t.title || '').toLowerCase();
        const descLower = (t.description || '').toLowerCase();
        
        if (titleLower.includes(q)) {
          score += 10;
          if (titleLower.startsWith(q)) score += 5;
        }
        if (descLower.includes(q)) {
          score += 2;
        }
        return { ...t, score };
      })
      .filter(t => t.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // 2. Search Projects
    const matchedProjects = allProjects
      .map(p => {
        let score = 0;
        const nameLower = (p.name || '').toLowerCase();
        const descLower = (p.description || '').toLowerCase();
        
        if (nameLower.includes(q)) {
          score += 12;
          if (nameLower.startsWith(q)) score += 5;
        }
        if (descLower.includes(q)) {
          score += 2;
        }
        return { ...p, score };
      })
      .filter(p => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // 3. Search Members
    const allMembers = Array.from(new Map(
      workspaces.flatMap(w => w.members || []).map(m => [m.id, m])
    ).values());

    const matchedMembers = allMembers
      .map(m => {
        let score = 0;
        const nameLower = (m.name || '').toLowerCase();
        const emailLower = (m.email || '').toLowerCase();
        
        if (nameLower.includes(q)) {
          score += 8;
          if (nameLower.startsWith(q)) score += 5;
        }
        if (emailLower.includes(q)) {
          score += 4;
        }
        return { ...m, score };
      })
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return { tasks: matchedTasks, projects: matchedProjects, members: matchedMembers };
  }, [searchQuery, allTasks, allProjects, workspaces]);

  // Profile Update State
  const [newName, setNewName] = useState(user?.name || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Sync profile update inputs when modal opens or user updates
  useEffect(() => {
    if (user && showProfileModal) {
      setNewName(user.name || '');
    }
  }, [user, showProfileModal]);

  const navigate = useNavigate();

  const notifRef = useRef(null);
  const profileRef = useRef(null);
  const wsRef = useRef(null);

  const handleAcceptInvite = async (n) => {
    if (n.membership_id) {
      await acceptInvitation(n.membership_id);
    }
    await markAsRead(n.id, 'accepted');
  };

  const handleRejectInvite = async (n) => {
    if (n.membership_id) {
      await rejectInvitation(n.membership_id);
    }
    await markAsRead(n.id, 'rejected');
  };

  const handleApproveLeave = async (n) => {
    if (n.workspace_id && n.target_user_id) {
      await removeMember(n.workspace_id, n.target_user_id);
    }
    await markAsRead(n.id, 'approved');
  };

  const handleApproveDelete = async (n) => {
    if (n.workspace_id) {
      await deleteWorkspace(n.workspace_id);
    }
    await markAsRead(n.id, 'approved');
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    const trimmedName = newName.trim();
    if (!trimmedName || trimmedName === user?.name) return;
    
    try {
      setIsSavingProfile(true);
      await api.put('/users/me', { name: trimmedName });
      await fetchProfile();
      import('../components/Toast').then(({ showToast }) => {
        showToast('success', 'Profile successfully updated!');
      });
      setShowProfileModal(false);
    } catch (err) {
      import('../components/Toast').then(({ showToast }) => {
        showToast('error', err.response?.data?.detail || err.message || 'Failed to update profile');
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
      if (wsRef.current && !wsRef.current.contains(event.target)) {
        setShowWorkspaceSelect(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const currentWorkspaceProjects = projects.filter(p => p.workspace_id === activeWorkspace?.id);

  return (
    <div className="flex h-screen bg-white font-sans overflow-hidden text-gray-900">
      {/* Sidebar (Left, Fixed) */}
      {/* Desktop Sidebar (Hover-to-expand overlay) */}
      <div className="hidden md:block w-20 h-full shrink-0 relative z-50">
        <aside 
          onMouseEnter={() => setIsSidebarHovered(true)}
          onMouseLeave={() => setIsSidebarHovered(false)}
          className={`absolute top-0 left-0 bg-gray-50 border-r border-gray-200 flex flex-col h-full shrink-0 transition-all duration-300 ease-in-out ${isSidebarHovered ? 'w-64 shadow-2xl' : 'w-20'}`}
        >
        {/* Sidebar Header / Logo */}
        <Link
          to="/home"
          onClick={() => {
            setActiveWorkspaceId(null);
            setActiveProjectId(null);
          }}
          className="h-16 px-6 border-b border-gray-200 flex items-center gap-2 hover:bg-gray-100/30 transition-colors"
        >
          <div className="w-8 h-8 rounded-xl bg-fuchsia-600 flex items-center justify-center text-white shadow-sm shadow-fuchsia-500">
            <Compass size={18} className="animate-spin-slow" />
          </div>
          <span className={`text-lg font-extrabold tracking-tight bg-gradient-to-r from-fuchsia-600 to-indigo-600 bg-clip-text text-transparent transition-all duration-300 ${isSidebarHovered ? 'opacity-100 w-auto' : 'opacity-0 w-0 overflow-hidden'}`}>
            Orbit Workspace
          </span>
        </Link>

        {/* Workspace Quick-Selector */}
        <div className="px-4 py-3 border-b border-gray-200 relative" ref={wsRef}>
          <button
            onClick={() => setShowWorkspaceSelect(!showWorkspaceSelect)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-full border border-gray-200 bg-white shadow-xs hover:bg-gray-50 text-left text-sm font-semibold transition-all"
          >
            <span className="truncate flex items-center gap-1.5">
              <Layers size={14} className="text-fuchsia-600" />
              {isSidebarHovered ? (activeWorkspace ? activeWorkspace.name : 'Select Workspace') : (activeWorkspace ? activeWorkspace.name.substring(0, 1) : 'S')}
            </span>
            <ChevronDown size={14} className={`text-gray-400 transition-transform ${showWorkspaceSelect ? 'rotate-180' : ''} ${isSidebarHovered ? 'opacity-100 block' : 'opacity-0 hidden'}`} />
          </button>

          {showWorkspaceSelect && (
            <div className="absolute left-4 right-4 mt-1 bg-white border border-gray-200 rounded-2xl shadow-lg py-2 z-50 animate-fadeIn">
              <div className="px-3 pb-1 border-b border-gray-100 mb-1">
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-gray-400">Workspaces</span>
              </div>
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => {
                    setActiveWorkspaceId(ws.id);
                    setActiveProjectId(null);
                    setShowWorkspaceSelect(false);
                    // Always go to workspace detail page — user selects project from there
                    navigate(`/workspaces/${slugify(ws.name)}/dashboard`);
                  }}
                  className={`w-full text-left px-4 py-2 text-xs font-semibold hover:bg-gray-50 flex items-center justify-between ${
                    activeWorkspace?.id === ws.id ? 'text-fuchsia-600 bg-fuchsia-50/50' : 'text-gray-700'
                  }`}
                >
                  <span className="truncate">{ws.name}</span>
                  {activeWorkspace?.id === ws.id && <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-600"></span>}
                </button>
              ))}
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={() => {
                    setShowWorkspaceSelect(false);
                    navigate('/workspaces');
                  }}
                  className="w-full text-left px-4 py-2 text-xs font-bold text-fuchsia-600 hover:bg-fuchsia-50/30 flex items-center gap-1"
                >
                  <Plus size={12} /> Manage Workspaces
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation Section */}
        <nav className="flex-1 px-4 py-4 space-y-1.5 overflow-y-auto">
          <NavLink
            to="/home"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-fuchsia-50 text-fuchsia-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <Compass size={16} />
            <span className={`whitespace-nowrap transition-all duration-300 ${isSidebarHovered ? 'opacity-100 w-auto ml-1' : 'opacity-0 w-0 overflow-hidden ml-0'}`}>Home</span>
          </NavLink>

          <NavLink
            to="/workspaces"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-fuchsia-50 text-fuchsia-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <Layers size={16} />
            <span className={`whitespace-nowrap transition-all duration-300 ${isSidebarHovered ? 'opacity-100 w-auto ml-1' : 'opacity-0 w-0 overflow-hidden ml-0'}`}>Workspaces</span>
          </NavLink>

          <NavLink
            to="/my-tasks"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-fuchsia-50 text-fuchsia-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <CheckSquare size={16} />
            <span className={`whitespace-nowrap transition-all duration-300 ${isSidebarHovered ? 'opacity-100 w-auto ml-1' : 'opacity-0 w-0 overflow-hidden ml-0'}`}>My Tasks</span>
          </NavLink>

          <NavLink
            to="/inbox"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-fuchsia-50 text-fuchsia-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <Inbox size={16} />
            <span className={`whitespace-nowrap transition-all duration-300 ${isSidebarHovered ? 'opacity-100 w-auto ml-1' : 'opacity-0 w-0 overflow-hidden ml-0'}`}>Inbox</span>
          </NavLink>

          {/* Projects Divider & List */}
          {activeWorkspace && (
            <div className="pt-6">
              <div className="px-4 pb-2 flex items-center justify-between">
                <span className={`text-[10px] uppercase tracking-wider font-extrabold text-gray-400 transition-all duration-300 ${isSidebarHovered ? 'opacity-100 block' : 'opacity-0 hidden'}`}>
                  Projects
                </span>
                <Link
                  to={`/workspaces/${slugify(activeWorkspace.name)}/dashboard`}
                  className="text-gray-400 hover:text-fuchsia-600 transition-colors"
                  title="Workspace Dashboard"
                >
                  <Settings size={12} className={isSidebarHovered ? 'opacity-100' : 'opacity-0'} />
                </Link>
              </div>

              <div className="space-y-0.5">
                {currentWorkspaceProjects.map((p) => (
                  <NavLink
                    key={p.id}
                    to={`/workspaces/${slugify(activeWorkspace.name)}/${slugify(p.name)}`}
                    onClick={() => setActiveProjectId(p.id)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-4 py-2 rounded-full text-xs font-semibold transition-all ${
                        isActive
                          ? 'bg-fuchsia-50/60 text-fuchsia-700 font-bold border border-fuchsia-100/40'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                      }`
                    }
                  >
                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                    <span className={`truncate whitespace-nowrap transition-all duration-300 ${isSidebarHovered ? "opacity-100 w-auto ml-1" : "opacity-0 w-0 overflow-hidden ml-0"}`}>{p.name}</span>
                  </NavLink>
                ))}

                {currentWorkspaceProjects.length === 0 && (
                  <div className="px-4 py-2 text-xs italic text-gray-400">
                    No projects. Go to dashboard to create one.
                  </div>
                )}
              </div>
            </div>
          )}
        </nav>

        {/* Sidebar Footer / User Quick Info */}
        <div className="p-4 border-t border-gray-200 bg-gray-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Avatar initials={user?.initials || '??'} name={user?.name || ''} size="sm" />
            <div className={`leading-tight transition-all duration-300 ${isSidebarHovered ? 'opacity-100 w-auto ml-2' : 'opacity-0 w-0 overflow-hidden ml-0'}`}>
              <div className="text-xs font-extrabold text-gray-900 truncate max-w-[120px]">{user?.name}</div>
              <div className="text-[10px] text-gray-500 font-medium capitalize">{activeWorkspace?.members.find(m => m.id === user?.id)?.role || user?.globalRole}</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className={`p-1.5 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-600 transition-all ${isSidebarHovered ? 'opacity-100 block' : 'opacity-0 hidden'}`}
            title="Log Out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      </div>

      {/* Main Shell Space (Right side) */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        
        {/* Top App Bar */}
        <header className="h-16 border-b border-gray-200 flex items-center justify-between px-8 bg-white shrink-0 z-30">
          
          {/* Breadcrumbs — Orbit › Workspace › Project */}
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-600">
            {/* Orbit root */}
            <span
              className="hover:text-fuchsia-600 transition-colors cursor-pointer"
              onClick={() => navigate('/workspaces')}
            >
              Orbit
            </span>

            {/* Workspace segment — only on workspace pages */}
            {activeWorkspace && location.pathname.startsWith('/workspaces') && (
              <>
                <span className="text-gray-300 font-normal">/</span>
                <span
                  className="hover:text-fuchsia-600 transition-colors cursor-pointer"
                  onClick={() => navigate(`/workspaces/${slugify(activeWorkspace.name)}/dashboard`)}
                >
                  {activeWorkspace.name}
                </span>
              </>
            )}

            {/* Project segment (only on kanban) */}
            {activeProject && location.pathname.split('/').length >= 4 && !location.pathname.endsWith('/dashboard') && (
              <>
                <span className="text-gray-300 font-normal">/</span>
                <span
                  className="text-gray-900 font-extrabold tracking-tight cursor-pointer hover:text-fuchsia-600 transition-colors"
                  onClick={() => navigate(location.pathname)}
                >
                  {activeProject.name}
                </span>
              </>
            )}

            {/* Static page labels */}
            {location.pathname === '/home' && (
              <>
                <span className="text-gray-300 font-normal">/</span>
                <span className="text-gray-900 font-extrabold tracking-tight">Home</span>
              </>
            )}
            {location.pathname === '/my-tasks' && (
              <>
                <span className="text-gray-300 font-normal">/</span>
                <span className="text-gray-900 font-extrabold tracking-tight">My Tasks</span>
              </>
            )}
            {location.pathname === '/inbox' && (
              <>
                <span className="text-gray-300 font-normal">/</span>
                <span className="text-gray-900 font-extrabold tracking-tight">Inbox</span>
              </>
            )}
          </div>

          {/* Search Bar */}
          <div className="w-1/3 max-w-md relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search tasks, projects, members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm rounded-full border border-gray-200 bg-gray-50/50 hover:bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 transition-all font-medium"
            />

            {searchQuery.trim() && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-2xl shadow-xl z-50 max-h-[360px] overflow-y-auto p-4 text-left space-y-4">
                
                {/* Projects Section */}
                {searchResults.projects.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 px-2">Projects</h4>
                    <div className="space-y-1">
                      {searchResults.projects.map(p => (
                        <div
                          key={p.id}
                          onClick={() => {
                            setSearchQuery('');
                            setActiveProjectId(p.id);
                            const wsForProj = workspaces.find(w => w.id === p.workspace_id);
                            navigate(`/workspaces/${slugify(wsForProj?.name || '')}/${slugify(p.name)}`);
                          }}
                          className="px-2 py-1.5 rounded-lg hover:bg-fuchsia-50/50 cursor-pointer text-xs font-semibold text-gray-800 transition-colors"
                        >
                          {p.name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tasks Section */}
                {searchResults.tasks.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 px-2">Tasks</h4>
                    <div className="space-y-1">
                      {searchResults.tasks.map(t => (
                        <div
                          key={t.id}
                          onClick={() => {
                            setSearchQuery('');
                            const taskProj = allProjects.find(proj => proj.id === t.project_id);
                            const taskWs = workspaces.find(w => w.id === taskProj?.workspace_id);
                            navigate(`/workspaces/${slugify(taskWs?.name || '')}/${slugify(taskProj?.name || '')}/tasks/${t.id}`);
                          }}
                          className="px-2 py-1.5 rounded-lg hover:bg-fuchsia-50/50 cursor-pointer text-xs font-semibold text-gray-800 transition-colors flex justify-between items-center"
                        >
                          <span className="truncate mr-2">{t.title}</span>
                          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[9px] font-bold rounded-md shrink-0 uppercase tracking-wider">
                            {t.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Teammates Section */}
                {searchResults.members.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5 px-2">Teammates</h4>
                    <div className="space-y-1">
                      {searchResults.members.map(m => (
                        <div
                          key={m.id}
                          className="px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-default text-xs font-semibold text-gray-800 transition-colors flex items-center gap-2"
                        >
                          <Avatar initials={m.initials} name={m.name} size="xs" />
                          <div>
                            <div>{m.name}</div>
                            <div className="text-[9px] text-gray-400 font-bold">{m.email}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {searchResults.projects.length === 0 && searchResults.tasks.length === 0 && searchResults.members.length === 0 && (
                  <div className="text-center text-xs text-gray-400 italic py-4">
                    No matching projects, tasks, or teammates.
                  </div>
                )}

              </div>
            )}
          </div>

          {/* Right Section: Header Actions */}
          <div className="flex items-center gap-4">
            
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="relative p-2 text-gray-500 hover:text-fuchsia-600 hover:bg-fuchsia-50 rounded-xl transition-all"
            >
              {darkMode ? <Sparkles size={18} className="text-amber-500" /> : <Palette size={18} />}
            </button>

            {/* Notification Bell */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className={`p-2 rounded-full hover:bg-gray-100 text-gray-600 transition-colors relative ${
                  showNotifications ? 'bg-gray-100 text-fuchsia-600' : ''
                }`}
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-black flex items-center justify-center rounded-full ring-2 ring-white animate-pulse">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-2xl shadow-xl py-3 z-50 animate-fadeIn">
                  <div className="px-4 pb-2 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-xs font-extrabold text-gray-900 tracking-tight">Notifications</span>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-[10px] font-extrabold text-fuchsia-600 hover:text-fuchsia-700"
                      >
                        Mark all as read
                      </button>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => markAsRead(n.id)}
                        className={`p-3 text-left hover:bg-gray-50 transition-colors cursor-pointer flex gap-2.5 items-start ${
                          !n.read ? 'bg-fuchsia-50/20' : ''
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${!n.read ? 'bg-fuchsia-600' : 'bg-transparent'}`}></span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-gray-900 truncate">{n.title}</div>
                          <div className="text-[11px] text-gray-600 mt-0.5 line-clamp-2">{n.message}</div>
                          <div className="text-[9px] text-gray-400 mt-1 font-semibold">{n.time}</div>
                          {n.message?.startsWith('You were invited to workspace:') && !n.read && (
                            <div className="mt-2 flex gap-1.5">
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await handleAcceptInvite(n);
                                }}
                                className="px-2 py-1 bg-fuchsia-600 hover:bg-fuchsia-700 text-white rounded-md text-[9px] font-black tracking-wider uppercase transition-all shadow-xs flex items-center gap-1"
                              >
                                <UserCheck size={10} /> Accept
                              </button>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await handleRejectInvite(n);
                                }}
                                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-[9px] font-bold tracking-wider uppercase transition-all flex items-center gap-1"
                              >
                                <UserX size={10} /> Reject
                              </button>
                            </div>
                          )}
                           {n.message?.includes('requests to leave workspace:') && !n.read && (
                             <div className="mt-2 flex gap-1.5">
                               <button
                                 onClick={async (e) => {
                                   e.stopPropagation();
                                   await handleApproveLeave(n);
                                 }}
                                 className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md text-[9px] font-black tracking-wider uppercase transition-all shadow-xs flex items-center gap-1"
                               >
                                 <UserCheck size={10} /> Approve
                               </button>
                               <button
                                 onClick={async (e) => {
                                   e.stopPropagation();
                                   await markAsRead(n.id, 'dismissed');
                                 }}
                                 className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-[9px] font-bold tracking-wider uppercase transition-all flex items-center gap-1"
                               >
                                 <UserX size={10} /> Dismiss
                               </button>
                             </div>
                           )}
                           {n.message?.includes('requests to delete workspace:') && !n.read && (
                             <div className="mt-2 flex gap-1.5">
                               <button
                                 onClick={async (e) => {
                                   e.stopPropagation();
                                   await handleApproveDelete(n);
                                 }}
                                 className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md text-[9px] font-black tracking-wider uppercase transition-all shadow-xs flex items-center gap-1"
                               >
                                 <UserCheck size={10} /> Approve Delete
                               </button>
                               <button
                                 onClick={async (e) => {
                                   e.stopPropagation();
                                   await markAsRead(n.id, 'dismissed');
                                 }}
                                 className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-[9px] font-bold tracking-wider uppercase transition-all flex items-center gap-1"
                               >
                                 <UserX size={10} /> Dismiss
                               </button>
                             </div>
                           )}
                         </div>
                      </div>
                    ))}
                    {notifications.length === 0 && (
                      <div className="p-4 text-center text-xs text-gray-400 italic">No alerts yet</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Profile Avatar Dropdown */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="flex items-center gap-1.5 focus:outline-none"
              >
                <Avatar initials={user?.initials || '??'} name={user?.name || ''} size="sm" onClick={() => {}} />
                <ChevronDown size={14} className="text-gray-500" />
              </button>

              {showProfileMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-2xl shadow-xl py-2 z-50 animate-fadeIn">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <div className="text-xs font-extrabold text-gray-900 truncate">{user?.name}</div>
                    <div className="text-[10px] text-gray-500 font-semibold truncate">{user?.email}</div>
                  </div>
                  
                  <button
                    onClick={() => {
                      setShowProfileMenu(false);
                      setShowProfileModal(true);
                    }}
                    className="w-full text-left px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <UserCheck size={14} /> Profile Settings
                  </button>

                  <button
                    onClick={() => {
                      setShowProfileMenu(false);
                      navigate('/settings');
                    }}
                    className="w-full text-left px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <Settings size={14} /> System Settings
                  </button>

                  <div className="border-t border-gray-100 my-1"></div>

                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <LogOut size={14} /> Log Out
                  </button>
                </div>
              )}
            </div>

          </div>

        </header>

        {/* View Content Area */}
        <main className="flex-1 overflow-auto bg-white relative pb-16 md:pb-0">
          <Outlet />
        </main>


      {/* Mobile Bottom Navigation (Instagram-style) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-200 z-50 flex items-center justify-around px-2 pb-safe">
        <NavLink to="/home" className={({ isActive }) => `flex flex-col items-center justify-center w-14 h-full ${isActive ? 'text-fuchsia-600' : 'text-gray-400 hover:text-gray-600'}`}>
          <Home size={22} />
          <span className="text-[9px] font-bold mt-1">Home</span>
        </NavLink>
        
        <NavLink to="/workspaces" className={({ isActive }) => `flex flex-col items-center justify-center w-14 h-full ${isActive ? 'text-fuchsia-600' : 'text-gray-400 hover:text-gray-600'}`}>
          <Layers size={22} />
          <span className="text-[9px] font-bold mt-1">Spaces</span>
        </NavLink>
        
        <NavLink to="/my-tasks" className={({ isActive }) => `flex flex-col items-center justify-center w-14 h-full ${isActive ? 'text-fuchsia-600' : 'text-gray-400 hover:text-gray-600'}`}>
          <CheckSquare size={22} />
          <span className="text-[9px] font-bold mt-1">Tasks</span>
        </NavLink>
        
        <NavLink to="/inbox" className={({ isActive }) => `flex flex-col items-center justify-center w-14 h-full ${isActive ? 'text-fuchsia-600' : 'text-gray-400 hover:text-gray-600'}`}>
          <div className="relative">
            <Inbox size={22} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full flex items-center justify-center text-[8px] font-bold text-white border-2 border-white shadow-sm">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          <span className="text-[9px] font-bold mt-1">Inbox</span>
        </NavLink>
        
        <button onClick={() => setShowProfileModal(true)} className="flex flex-col items-center justify-center w-14 h-full text-gray-400 hover:text-gray-600">
          <Avatar initials={user?.initials || '??'} name={user?.name || ''} size="sm" />
          <span className="text-[9px] font-bold mt-1">Profile</span>
        </button>
      </nav>

      </div>

      {/* Profile Settings Modal */}
      <Modal isOpen={showProfileModal} onClose={() => setShowProfileModal(false)} title="Profile Settings">
        <div className="flex flex-col items-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-fuchsia-600 to-indigo-600 text-white flex items-center justify-center text-2xl font-black shadow-md mb-4 border-4 border-white ring-4 ring-fuchsia-50">
            {user?.initials || '??'}
          </div>
          <h4 className="text-lg font-black text-gray-900 leading-tight">{user?.name}</h4>
          <span className="text-xs text-gray-500 font-medium mt-0.5">{user?.email}</span>

          <div className="w-full mt-6 space-y-4 border-t border-gray-100 pt-6">
            
            {/* Roles & Permissions Legend */}
            <div className="bg-fuchsia-50/30 p-3.5 rounded-2xl border border-fuchsia-100/50 text-left space-y-2">
              <span className="text-[10px] font-extrabold text-fuchsia-700 uppercase tracking-wider block">Security & Access Access Roles</span>
              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="bg-white p-2.5 rounded-xl border border-fuchsia-100/50">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Global System Role</span>
                  <span className="text-xs font-black text-gray-800 flex items-center gap-1 mt-0.5">
                    <Shield size={12} className="text-fuchsia-600" />
                    {user?.globalRole || 'User'}
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-fuchsia-100/50">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Active Workspace Role</span>
                  <span className="text-xs font-black text-gray-800 flex items-center gap-1 mt-0.5">
                    <Shield size={12} className="text-indigo-600" />
                    {activeWorkspace ? (activeWorkspace.members?.find(m => m.email?.toLowerCase() === user?.email?.toLowerCase())?.role || 'Viewer') : 'None'}
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed pt-1 border-t border-fuchsia-100/40 font-medium">
                💡 <strong className="font-bold text-gray-700">Global Role</strong> determines baseline account capability. <strong className="font-bold text-gray-700">Workspace Role</strong> is role-based access (Admin, Editor, or Viewer) assigned specifically inside this workspace.
              </p>
            </div>

            {/* Profile Update Form */}
            <div className="border-t border-gray-100 pt-4 text-left">
              <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block mb-3">Update Profile Information</span>
              <form onSubmit={handleProfileUpdate} className="space-y-3">
                <div>
                  <label className="text-[9px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Full Name</label>
                  <input
                    type="text"
                    placeholder="Enter your name"
                    value={newName}
                    onChange={(e) => {
                      if (e.target.value.length <= 100) setNewName(e.target.value);
                    }}
                    maxLength={100}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 transition-all font-medium"
                    required
                  />
                  {newName.length >= 100 && (
                    <p className="text-[10px] text-amber-500 mt-1 font-bold">Character limit reached (100).</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={isSavingProfile || !newName.trim() || newName.trim() === user?.name}
                  className="w-full py-2.5 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-xs mt-4"
                >
                  Save Profile Settings
                </button>
              </form>
            </div>
          </div>

          <div className="mt-6 w-full flex justify-end">
            <PillButton variant="secondary" size="md" onClick={() => setShowProfileModal(false)}>
              Close Settings
            </PillButton>
          </div>
        </div>
      </Modal>

      <RememberMeDialog
        isOpen={showSaveDeviceDialog}
        onSave={handleSaveDevice}
        onDismiss={handleDismissSaveDevice}
      />

    </div>
  );
}
