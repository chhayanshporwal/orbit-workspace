import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { api, getWsBase } from '../utils/api';
import { showToast } from '../components/Toast';

const WorkspaceContext = createContext(null);

// Convert backend workspace memberships array into a flat members array for UI
function mapMembersFromMemberships(memberships) {
  if (!memberships || !Array.isArray(memberships)) return [];
  return memberships.map(m => {
    const userObj = m.user || {};
    const email = userObj.email || '';
    const name = userObj.name || email.split('@')[0];
    const initials = name
      ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
      : email.substring(0, 2).toUpperCase();
    return {
      id: m.user_id,
      name: name,
      email: email,
      initials: initials,
      role: m.role.charAt(0).toUpperCase() + m.role.slice(1), // admin -> Admin
      status: m.status || (m.is_pending ? 'invited' : 'accepted'),
      invitedAt: m.invited_at,
      joinedAt: m.joined_at,
    };
  });
}

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  
  const [workspaces, setWorkspaces] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [allTasksLoading, setAllTasksLoading] = useState(false);
  const [allProjects, setAllProjects] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [invitations, setInvitations] = useState([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [userProjectViews, setUserProjectViews] = useState({});
  
  // Use a ref to prevent stale closure issues with notification polling
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const fetchAllTasksAcrossWorkspaces = useCallback(async () => {
    if (!user) return;
    setAllTasksLoading(true);
    try {
      const data = await api.get('/users/me/all-tasks');
      if (data) {
        const mappedTasks = (data.tasks || []).map(t => ({
          ...t,
          status: (t.status || 'To Do').toLowerCase().replace(/\s+/g, ''),
          projectName: t.project_name,
          workspaceName: t.workspace_name,
        }));
        const mappedProjects = (data.projects || []).map(p => ({
          ...p,
          createdAt: p.created_at,
        }));
        setAllTasks(mappedTasks);
        setAllProjects(mappedProjects);
      }
    } catch (e) {
      console.error('Fetch All Tasks Error:', e);
    } finally {
      setAllTasksLoading(false);
    }
  }, [user]);

  // ─── Fetchers ───────────────────────────────────────
  const fetchUserProjectViews = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get('/user/project-views');
      if (data) {
        // Merge with local storage workspace views
        const localViews = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('ws-')) {
            localViews[key] = localStorage.getItem(key);
          }
        }
        setUserProjectViews({ ...data, ...localViews });
      }
    } catch (e) {
      console.error('Fetch User Project Views Error:', e);
    }
  }, [user]);

  const updateUserProjectView = async (projectId) => {
    if (!user || !projectId) return;
    
    // Handle workspace-level views stored locally
    if (typeof projectId === 'string' && projectId.startsWith('ws-')) {
      const now = new Date().toISOString();
      setUserProjectViews(prev => ({ ...prev, [projectId]: now }));
      localStorage.setItem(projectId, now);
      return;
    }

    try {
      const data = await api.post(`/projects/${projectId}/view`);
      if (data && data.status === 'success') {
        setUserProjectViews(prev => ({
          ...prev,
          [projectId]: data.last_viewed_at
        }));
      }
    } catch (e) {
      console.error('Update User Project View Error:', e);
    }
  };

  const fetchWorkspaces = useCallback(async () => {
    if (!user) return [];
    try {
      const data = await api.get(`/users/${user.id}/workspaces`);
      if (data) {
        // Enrich each workspace with a flat 'members' array for UI consumption
        const enriched = data.map(ws => ({
          ...ws,
          createdAt: ws.created_at,
          members: mapMembersFromMemberships(ws.memberships),
        }));
        setWorkspaces(enriched);
        fetchUserProjectViews();
        fetchAllTasksAcrossWorkspaces();
        return enriched;
      }
    } catch (e) {
      console.error('Fetch Workspaces Error:', e);
    }
    return [];
  }, [user, fetchAllTasksAcrossWorkspaces]);

  const fetchProjects = useCallback(async (wsId) => {
    if (!user || !wsId) return [];
    try {
      const data = await api.get(`/workspaces/${wsId}/projects`);
      if (data) {
        const enriched = data.map(p => ({
          ...p,
          createdAt: p.created_at,
        }));
        setProjects(enriched);
        return enriched;
      }
    } catch (e) {
      console.error('Fetch Projects Error:', e);
    }
    return [];
  }, [user]);

  const fetchTasks = useCallback(async (projId) => {
    if (!user || !projId) return [];
    try {
      const data = await api.get(`/projects/${projId}/tasks`);
      if (data) {
        // Map backend status ("To Do", "In Progress", "Done") to frontend keys
        const mappedTasks = data.map(t => {
          const proj = allProjects.find(p => p.id === t.project_id) || projects.find(p => p.id === t.project_id);
          return {
            ...t,
            status: (t.status || 'To Do').toLowerCase().replace(/\s+/g, ''),
            workspace_id: proj ? proj.workspace_id : activeWorkspaceId,
          };
        });
        setTasks(mappedTasks);
        return mappedTasks;
      }
    } catch (e) {
      console.error('Fetch Tasks Error:', e);
    }
    return [];
  }, [user]);

  const fetchNotifications = useCallback(async () => {
    if (!userRef.current) return;
    try {
      const data = await api.get('/notifications');
      if (data) {
        const mappedNotifs = data.map(n => ({
          id: n.id,
          title: 'Notification',
          message: n.message,
          read: n.is_read,
          time: new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          created_at: n.created_at,
          workspace_id: n.workspace_id,
          target_user_id: n.target_user_id,
          membership_id: n.membership_id,
        }));
        setNotifications(prev => {
          // Identify new unread notifications that aren't in the previous state
          const newNotifs = mappedNotifs.filter(n => !n.read && !prev.some(p => p.id === n.id));
          if (newNotifs.length > 0 && prev.length > 0) {
            // Only toast if prev.length > 0 so we don't spam toasts on initial load
            newNotifs.forEach(n => showToast('info', n.message));
          }
          return mappedNotifs;
        });
      }
    } catch (e) {
      console.error('Fetch Notifications Error:', e);
    }
  }, []);

  const fetchInvitations = useCallback(async () => {
    if (!user) return [];
    setInvitationsLoading(true);
    try {
      const data = await api.get('/workspace-invitations');
      if (data) {
        setInvitations(data);
        return data;
      }
    } catch (e) {
      console.error('Fetch Invitations Error:', e);
    } finally {
      setInvitationsLoading(false);
    }
    return [];
  }, [user]);

  const acceptInvitation = async (membershipId) => {
    try {
      await api.post(`/workspace-invitations/${membershipId}/accept`);
      await fetchInvitations();
      await fetchWorkspaces();
    } catch (e) {
      showToast('error', e.message || 'Failed to accept invitation');
    }
  };

  const rejectInvitation = async (membershipId) => {
    try {
      await api.post(`/workspace-invitations/${membershipId}/reject`);
      await fetchInvitations();
    } catch (e) {
      showToast('error', e.message || 'Failed to reject invitation');
    }
  };

  // ─── Initialization & data chaining ─────────────────
  useEffect(() => {
    if (user) {
      fetchWorkspaces();
      fetchNotifications();
      fetchInvitations();
    } else {
      setWorkspaces([]);
      setProjects([]);
      setTasks([]);
      setNotifications([]);
      setInvitations([]);
      setActiveWorkspaceId(null);
      setActiveProjectId(null);
    }
  }, [user, fetchInvitations]); // Intentionally only depends on user identity changing

  // Load projects when workspace changes
  useEffect(() => {
    if (activeWorkspaceId) {
      fetchProjects(activeWorkspaceId);
    }
  }, [activeWorkspaceId, fetchProjects]);

  // Load tasks when project changes
  useEffect(() => {
    if (activeProjectId) {
      fetchTasks(activeProjectId);
    }
  }, [activeProjectId, fetchTasks]);

  // Poll notifications every 30s while logged in as a fallback
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [user, fetchNotifications]);


  // ─── Derived state ──────────────────────────────────
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null;
  const activeProject = projects.find(p => p.id === activeProjectId) || null;

  // Compute RBAC flags from the active workspace's memberships
  const roleFlags = (() => {
    if (!user || !activeWorkspace) return { isAdmin: false, isEditor: false, isViewer: true };
    const myMembership = activeWorkspace.members?.find(
      m => m.id === user.id || m.email.toLowerCase() === user.email.toLowerCase()
    );
    const roleStr = myMembership ? myMembership.role.toLowerCase() : 'viewer';
    return {
      isAdmin: roleStr === 'admin',
      isEditor: roleStr === 'admin' || roleStr === 'editor',
      isViewer: roleStr === 'viewer',
    };
  })();

  // ─── Workspace Actions ──────────────────────────────
  const createWorkspace = async (name) => {
    try {
      const data = await api.post('/workspaces/', { name });
      if (data) {
        const enriched = await fetchWorkspaces();
        setActiveWorkspaceId(data.id);
        return data;
      }
    } catch (e) {
      showToast('error', e.message);
    }
  };

  const deleteWorkspace = async (workspaceId) => {
    try {
      const res = await api.post(`/workspaces/${workspaceId}/delete-requests`);
      if (res && res.status === 'deleted') {
        showToast('success', 'Workspace successfully deleted.');
        const remaining = await fetchWorkspaces();
        if (activeWorkspaceId === workspaceId) {
          setActiveWorkspaceId(remaining.length > 0 ? remaining[0].id : null);
        }
        return 'deleted';
      } else if (res && res.status === 'requested') {
        showToast('info', "Delete request submitted to other admins for approval.");
        return 'requested';
      }
    } catch (e) {
      showToast('error', e.message);
    }
  };

  const updateWorkspace = async (workspaceId, name, description) => {
    try {
      await api.put(`/workspaces/${workspaceId}`, { name, description });
      await fetchWorkspaces();
    } catch (e) {
      showToast('error', e.message);
    }
  };

  const inviteMember = async (workspaceId, email, role = 'viewer') => {
    try {
      await api.post(`/workspaces/${workspaceId}/members`, {
        email,
        role: role.toLowerCase(),
      });
      await fetchWorkspaces();
    } catch (e) {
      showToast('error', e.message);
    }
  };

  const updateMemberRole = async (workspaceId, userId, newRole) => {
    try {
      await api.put(`/workspaces/${workspaceId}/members/${userId}`, {
        role: newRole.toLowerCase(),
      });
      await fetchWorkspaces();
    } catch (e) {
      showToast('error', e.message);
    }
  };

  const removeMember = async (workspaceId, userId, reason = null) => {
    try {
      const url = reason ? `/workspaces/${workspaceId}/members/${userId}?reason=${encodeURIComponent(reason)}` : `/workspaces/${workspaceId}/members/${userId}`;
      await api.delete(url);
      await fetchWorkspaces();
    } catch (e) {
      showToast('error', e.message);
    }
  };

  const createProject = async (workspaceId, name, description) => {
    try {
      const data = await api.post('/projects/', {
        name,
        description,
        workspace_id: workspaceId,
      });
      if (data) {
        await fetchProjects(workspaceId);
        setAllProjects(prev => [...prev, data]);
        setActiveProjectId(data.id);
        return data;
      }
    } catch (e) {
      showToast('error', e.message);
    }
  };

  const deleteProject = async (projectId) => {
    try {
      await api.delete(`/projects/${projectId}`);
      if (activeWorkspaceId) {
        await fetchProjects(activeWorkspaceId);
      }
      setAllProjects(prev => prev.filter(p => p.id !== projectId));
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
      }
    } catch (e) {
      showToast('error', e.message);
    }
  };

  const updateProject = async (projectId, name, description) => {
    try {
      await api.put(`/projects/${projectId}`, { name, description });
      if (activeWorkspaceId) {
        await fetchProjects(activeWorkspaceId);
      }
      setAllProjects(prev => prev.map(p => p.id === projectId ? { ...p, name, description } : p));
    } catch (e) {
      showToast('error', e.message);
    }
  };

  // ─── Task Actions ───────────────────────────────────
  const createTask = async (projectId, taskData) => {
    try {
      const body = {
        title: taskData.title,
        description: taskData.description || '',
        priority_level: taskData.priority_level || 1,
        assignee_id: taskData.assigneeId ? parseInt(taskData.assigneeId) : null,
        due_date: taskData.dueDate ? new Date(taskData.dueDate).toISOString() : null,
      };
      const data = await api.post(`/projects/${projectId}/tasks`, body);
      if (data) {
        await fetchTasks(projectId);
      }
    } catch (e) {
      showToast('error', e.message);
    }
  };

  const updateTask = async (taskId, updatedFields) => {
    try {
      const payload = {};
      if (updatedFields.title !== undefined) {
        payload.title = updatedFields.title;
      }
      if (updatedFields.description !== undefined) {
        payload.description = updatedFields.description;
      }
      if (updatedFields.priority_level !== undefined) {
        payload.priority_level = parseInt(updatedFields.priority_level) || 1;
      }
      if (updatedFields.assigneeId !== undefined || updatedFields.assignee_id !== undefined) {
        const val = updatedFields.assigneeId !== undefined ? updatedFields.assigneeId : updatedFields.assignee_id;
        payload.assignee_id = val ? parseInt(val) : null;
      }
      if (updatedFields.reassignment_reason !== undefined) {
        payload.reassignment_reason = updatedFields.reassignment_reason;
      }
      if (updatedFields.dueDate !== undefined) {
        payload.due_date = updatedFields.dueDate ? new Date(updatedFields.dueDate).toISOString() : null;
      }
      if (updatedFields.status !== undefined) {
        const statusMap = {
          todo: 'To Do',
          inprogress: 'In Progress',
          done: 'Done',
        };
        payload.status = statusMap[updatedFields.status] || updatedFields.status;
      }

      await api.put(`/tasks/${taskId}`, payload);

      if (activeProjectId) {
        await fetchTasks(activeProjectId);
      }
    } catch (e) {
      console.error('Update Task Error:', e);
      showToast('error', e.message || 'Failed to update task');
    }
  };

  const deleteTask = async (taskId) => {
    try {
      await api.delete(`/tasks/${taskId}`);
      if (activeProjectId) {
        await fetchTasks(activeProjectId);
      }
    } catch (e) {
      showToast('error', e.message);
    }
  };

  // Smart Assign (uses backend /auto-assign creation route)
  const smartAssignTask = async (projectId, taskData) => {
    try {
      const body = {
        title: taskData.title,
        description: taskData.description || '',
        priority_level: 1,
        due_date: taskData.dueDate ? new Date(taskData.dueDate).toISOString() : null,
        assignee_id: null,
      };
      const data = await api.post(`/projects/${projectId}/tasks/auto-assign`, body);
      if (data) {
        await fetchTasks(projectId);
      }
    } catch (e) {
      showToast('error', e.message);
    }
  };

  // ─── Comments ───────────────────────────────────────
  const addComment = async (taskId, text) => {
    try {
      await api.post(`/tasks/${taskId}/comments`, { content: text });
    } catch (e) {
      showToast('error', e.message);
    }
  };

  // ─── Notifications ─────────────────────────────────
  const markNotificationRead = async (notifId, action = null) => {
    try {
      const url = action ? `/notifications/${notifId}/read?action=${action}` : `/notifications/${notifId}/read`;
      await api.put(url);
      await fetchNotifications();
    } catch (e) {
      console.error(e);
    }
  };

  const markAllNotificationsRead = async () => {
    const unread = notifications.filter(n => !n.read);
    try {
      await Promise.all(unread.map(n => api.put(`/notifications/${n.id}/read`)));
      await fetchNotifications();
    } catch (e) {
      console.error(e);
    }
  };

  // ─── Refresh helper for WebSocket ───────────────────
  const refreshData = useCallback(() => {
    if (activeProjectId) fetchTasks(activeProjectId);
    if (activeWorkspaceId) fetchProjects(activeWorkspaceId);
    fetchNotifications();
  }, [activeProjectId, activeWorkspaceId, fetchTasks, fetchProjects, fetchNotifications]);

  // Establish a global WebSocket connection with auto-reconnect
  const wsRef = useRef(null);
  const wsReconnectTimeoutRef = useRef(null);
  const wsReconnectAttemptsRef = useRef(0);

  useEffect(() => {
    if (!user) {
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      clearTimeout(wsReconnectTimeoutRef.current);
      wsReconnectAttemptsRef.current = 0;
      return;
    }

    const token = localStorage.getItem('orbit_access_token') || sessionStorage.getItem('orbit_access_token');
    if (!token) return;

    function connectWebSocket() {
      const wsUrl = `${getWsBase()}/ws?token=${token}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        wsReconnectAttemptsRef.current = 0; // Reset on successful connect
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          // Refresh workspaces, projects, tasks, notifications, and invitations
          refreshData();
          fetchWorkspaces();
          fetchInvitations();
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      ws.onclose = () => {
        // Exponential backoff reconnect: 1s, 2s, 4s, 8s, max 30s
        const attempt = wsReconnectAttemptsRef.current;
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        wsReconnectAttemptsRef.current = attempt + 1;
        wsReconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
      };

      ws.onerror = () => {
        ws.close(); // triggers onclose -> reconnect
      };
    }

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on unmount
        wsRef.current.close();
      }
      clearTimeout(wsReconnectTimeoutRef.current);
    };
  }, [user, refreshData, fetchWorkspaces, fetchInvitations]);

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        projects,
        tasks,
        notifications,
        allTasks,
        allTasksLoading,
        allProjects,
        setAllProjects,
        fetchAllTasksAcrossWorkspaces,
        activeWorkspaceId,
        activeWorkspace,
        activeProjectId,
        activeProject,
        role: roleFlags,
        loading,
        setActiveWorkspaceId,
        setActiveProjectId,
        createWorkspace,
        deleteWorkspace,
        updateWorkspace,
        inviteMember,
        updateMemberRole,
        removeMember,
        createProject,
        deleteProject,
        updateProject,
        createTask,
        updateTask,
        deleteTask,
        addComment,
        markAllNotificationsRead,
        markNotificationRead,
        smartAssignTask,
        refreshData,
        fetchWorkspaces,
        invitations,
        invitationsLoading,
    userProjectViews,
    updateUserProjectView,
        fetchInvitations,
        acceptInvitation,
        rejectInvitation,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
