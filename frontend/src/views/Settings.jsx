import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { Shield, Key, FileArchive, Activity, ShieldCheck, LogOut } from 'lucide-react';
import { showToast } from '../components/Toast';

const parseDeviceName = (userAgent) => {
  if (!userAgent) return 'Unknown Device';
  
  let browser = 'Browser';
  if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Edg')) browser = 'Edge';
  else if (userAgent.includes('Chrome')) browser = 'Chrome';
  else if (userAgent.includes('Safari')) browser = 'Safari';

  let os = 'Unknown OS';
  if (userAgent.includes('Mac OS X')) os = 'macOS';
  else if (userAgent.includes('Windows NT')) os = 'Windows';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';

  if (browser === 'Browser' && os === 'Unknown OS') {
    return userAgent.length > 30 ? userAgent.substring(0, 30) + '...' : userAgent;
  }
  
  return `${os} • ${browser}`;
};

export default function Settings() {
  const { user, fetchProfile, logout } = useAuth();
  const location = useLocation();
  
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get('tab') || 'security';
  });
  
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab) setActiveTab(tab);
  }, [location.search]);
  
  // Security Tab State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Login Logs Tab State
  const [sessions, setSessions] = useState([]);
  
  // Archive Logs Tab State
  const [archiveLogs, setArchiveLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Account Deletion State
  const [deletionPassword, setDeletionPassword] = useState('');
  const [deletionOtp, setDeletionOtp] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch functions
  const fetchSessions = useCallback(async () => {
    try {
      const data = await api.get('/users/me/sessions');
      if (data) setSessions(data);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  }, []);

  const fetchArchiveLogs = useCallback(async () => {
    try {
      setLogsLoading(true);
      const data = await api.get('/audit-logs');
      if (data) {
        // Filter only workspace_deleted and project_deleted
        const deletions = data.filter(log => 
          log.action === 'workspace_deleted' || log.action === 'project_deleted'
        );
        setArchiveLogs(deletions);
      }
    } catch (err) {
      console.error('Failed to fetch archive logs:', err);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'logins') fetchSessions();
    if (activeTab === 'archive') {
      fetchArchiveLogs();
    }
  }, [activeTab, fetchSessions, fetchArchiveLogs]);

  useEffect(() => {
    if (activeTab === 'archive' && archiveLogs.length > 0) {
      localStorage.setItem('archive_last_viewed', new Date().toISOString());
    }
  }, [activeTab, archiveLogs]);

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    if (!newPassword || !currentPassword) return;

    if (newPassword.length < 8) {
      showToast('error', 'Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      showToast('error', 'Passwords do not match.');
      return;
    }

    try {
      setIsSaving(true);
      await api.put('/users/me', {
        password: newPassword,
        current_password: currentPassword
      });
      await fetchProfile();
      showToast('success', 'Password successfully updated! All other sessions have been logged out.');
      setNewPassword('');
      setConfirmNewPassword('');
      setCurrentPassword('');
    } catch (err) {
      showToast('error', err.response?.data?.detail || err.message || 'Failed to update password');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevokeSession = async (session) => {
    try {
      await api.post(`/users/me/sessions/${session.id}/revoke`);
      if (session.is_current_session) {
        logout();
      } else {
        await fetchSessions();
        showToast('success', 'Session logged out successfully');
      }
    } catch (err) {
      showToast('error', err.message || 'Failed to logout session');
    }
  };

  const handleRequestDeletionOtp = async () => {
    try {
      await api.post('/deletion-otp');
      setIsOtpSent(true);
      showToast('success', 'Deletion OTP sent to your email.');
    } catch (err) {
      showToast('error', err.response?.data?.detail || err.message || 'Failed to send OTP');
    }
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    if (!deletionPassword && !deletionOtp) return;
    
    try {
      setIsDeleting(true);
      await api.post('/schedule-deletion', {
        password: deletionPassword || null,
        otp: deletionOtp || null
      });
      showToast('success', 'Account scheduled for deletion. You will be logged out.');
      setTimeout(() => {
        window.location.href = '/login';
      }, 1500);
    } catch (err) {
      showToast('error', err.response?.data?.detail || err.message || 'Failed to schedule deletion');
      setIsDeleting(false);
    }
  };

  // Smart Trimming & Save Locking
  const isPasswordSaveDisabled = isSaving || !newPassword.trim() || !currentPassword.trim();

  return (
    <div className="p-8 max-w-5xl mx-auto font-sans text-left">
      <div className="pb-6 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 flex items-center gap-2">
            <ShieldCheck className="text-fuchsia-600" size={26} />
            System Settings
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Manage your security, view active sessions, and access archived data.
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-col md:flex-row gap-8">
        {/* Sidebar Nav */}
        <div className="w-full md:w-64 shrink-0 space-y-1">
          <button
            onClick={() => setActiveTab('security')}
            className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-3 transition-colors ${
              activeTab === 'security' ? 'bg-fuchsia-50 text-fuchsia-700' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Key size={16} /> Security & Password
          </button>
          <button
            onClick={() => setActiveTab('logins')}
            className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-3 transition-colors ${
              activeTab === 'logins' ? 'bg-fuchsia-50 text-fuchsia-700' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Shield size={16} /> Login Logs & Sessions
          </button>
          <button
            onClick={() => setActiveTab('archive')}
            className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-3 transition-colors ${
              activeTab === 'archive' ? 'bg-fuchsia-50 text-fuchsia-700' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <FileArchive size={16} /> Archive Logs
          </button>
          <button
            onClick={() => setActiveTab('deletion')}
            className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-3 transition-colors mt-4 border border-rose-100 ${
              activeTab === 'deletion' ? 'bg-rose-50 text-rose-700' : 'text-rose-600 hover:bg-rose-50'
            }`}
          >
            <Shield size={16} /> Delete Account
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-white border border-gray-200 rounded-3xl p-6 shadow-xs min-h-[400px]">
          {activeTab === 'security' && (
            <div className="max-w-md">
              <h2 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider mb-6 flex items-center gap-2">
                <Key size={16} className="text-fuchsia-600" />
                Change Password
              </h2>
              <form onSubmit={handlePasswordUpdate} className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">New Password</label>
                  <input
                    type="password"
                    placeholder="Enter new password"
                    value={newPassword}
                    maxLength={128}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-4 py-2.5 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 transition-all font-medium"
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    placeholder="Repeat new password"
                    value={confirmNewPassword}
                    maxLength={128}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full px-4 py-2.5 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 transition-all font-medium"
                    required
                  />
                </div>
                <div className="pt-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Current Password</label>
                  <input
                    type="password"
                    placeholder="Verify current password"
                    value={currentPassword}
                    maxLength={128}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-4 py-2.5 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 transition-all font-medium"
                    required
                  />
                  <p className="text-[9px] text-gray-400 mt-1">Required to authorize changes to your security settings.</p>
                </div>
                <button
                  type="submit"
                  disabled={isPasswordSaveDisabled}
                  className="w-full mt-4 py-2.5 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                >
                  Update Password
                </button>
              </form>
            </div>
          )}

          {activeTab === 'logins' && (
            <div>
              <h2 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider mb-6 flex items-center gap-2">
                <Shield size={16} className="text-fuchsia-600" />
                Active Sessions
              </h2>
              <div className="space-y-3 mb-10">
                {sessions.filter(s => s.is_active).length === 0 ? (
                  <p className="text-[10px] text-gray-400 font-medium italic">No active sessions.</p>
                ) : (
                  (() => {
                    const activeSessions = sessions.filter(s => s.is_active).sort((a, b) => new Date(b.last_activity_at) - new Date(a.last_activity_at));
                    const recentSessions = activeSessions.slice(0, 5);
                    const olderSessions = activeSessions.slice(5);

                    const renderSession = (session) => (
                      <div key={session.id} className="bg-gray-50 border border-gray-100 p-4 rounded-2xl flex items-center justify-between gap-3 text-xs font-semibold">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-800">{parseDeviceName(session.device_name)}</span>
                            {session.is_current_session && (
                              <span className="bg-fuchsia-100 text-fuchsia-700 text-[9px] px-1.5 py-0.5 rounded-sm uppercase tracking-wider">Current</span>
                            )}
                          </div>
                          <span className="text-[10px] text-gray-400">Active: {new Date(session.last_activity_at).toLocaleString()}</span>
                          <span className="text-[10px] text-gray-400">Location: {session.location || 'Unknown'} (IP: {session.ip_address || 'Unknown'})</span>
                        </div>
                        <button
                          onClick={() => handleRevokeSession(session)}
                          className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-[10px] font-extrabold border border-red-100 transition-all shrink-0"
                        >
                          <LogOut size={12} className="inline mr-1" /> Logout
                        </button>
                      </div>
                    );

                    return (
                      <>
                        {recentSessions.map(renderSession)}
                        
                        {olderSessions.length > 0 && (
                          <details className="group border border-gray-100 rounded-2xl bg-white overflow-hidden mt-4">
                            <summary className="px-4 py-3 text-xs font-bold text-gray-600 cursor-pointer hover:bg-gray-50 list-none flex justify-between items-center transition-colors">
                              <span>View {olderSessions.length} older active sessions</span>
                              <span className="text-[10px] text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                            </summary>
                            <div className="p-4 space-y-3 border-t border-gray-100 bg-gray-50/30">
                              {olderSessions.map(renderSession)}
                            </div>
                          </details>
                        )}
                      </>
                    );
                  })()
                )}
              </div>

              <h2 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider mb-6 flex items-center gap-2">
                <Activity size={16} className="text-gray-400" />
                Login History
              </h2>
              <div className="space-y-4">
                {sessions.filter(s => !s.is_active).length === 0 ? (
                  <p className="text-[10px] text-gray-400 font-medium italic">No historical logs.</p>
                ) : (
                  Object.entries(
                    sessions.filter(s => !s.is_active).reduce((acc, session) => {
                      const device = session.device_name || 'Unknown Device';
                      if (!acc[device]) acc[device] = [];
                      acc[device].push(session);
                      return acc;
                    }, {})
                  ).map(([device, deviceSessions]) => (
                    <details key={device} className="group border border-gray-100 rounded-2xl overflow-hidden bg-white">
                      <summary className="bg-gray-50/50 px-4 py-3 cursor-pointer flex items-center justify-between list-none hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-700">{parseDeviceName(device)}</span>
                          <span className="text-[9px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{deviceSessions.length} logs</span>
                        </div>
                        <span className="text-[10px] text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                      </summary>
                      <div className="divide-y divide-gray-50 bg-gray-50/30">
                        {deviceSessions.map(session => (
                          <details key={session.id} className="group/item">
                            <summary className="p-3 text-[10px] font-semibold text-gray-500 flex justify-between items-center gap-3 hover:bg-white cursor-pointer list-none transition-colors">
                              <div className="flex flex-col gap-0.5">
                                <span className="font-bold text-gray-600">{new Date(session.login_at).toLocaleString()}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-[9px] bg-gray-100 text-gray-600 px-2 py-1 rounded-md font-bold shrink-0">
                                  Logged out
                                </span>
                                <span className="text-[10px] text-gray-300 group-open/item:rotate-180 transition-transform">▼</span>
                              </div>
                            </summary>
                            <div className="px-4 py-3 bg-white text-[10px] text-gray-600 space-y-2 border-t border-gray-50">
                              <p><strong className="text-gray-800">IP Address:</strong> {session.ip_address || 'Unknown'}</p>
                              <p><strong className="text-gray-800">Location:</strong> {session.location || 'Unknown'}</p>
                              <p><strong className="text-gray-800">Login Time:</strong> {new Date(session.login_at).toLocaleString()}</p>
                              <p><strong className="text-gray-800">Logout Time:</strong> {session.logout_at ? new Date(session.logout_at).toLocaleString() : 'Unknown'}</p>
                              <p><strong className="text-gray-800">Device/Browser Agent:</strong> <span className="break-all">{session.device_name}</span></p>
                            </div>
                          </details>
                        ))}
                      </div>
                    </details>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'archive' && (
            <div>
              <h2 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider mb-6 flex items-center gap-2">
                <FileArchive size={16} className="text-fuchsia-600" />
                Archive Logs
              </h2>
              <div className="space-y-4">
                {logsLoading ? (
                  <div className="flex justify-center p-8"><span className="animate-pulse w-6 h-6 rounded-full bg-fuchsia-300"></span></div>
                ) : archiveLogs.length > 0 ? (
                  (() => {
                    const renderedLogs = [];
                    let separatorInjected = false;
                    
                    const lastViewed = localStorage.getItem('archive_last_viewed');
                    
                    archiveLogs.forEach(log => {
                      if (lastViewed && new Date(log.created_at) <= new Date(lastViewed) && !separatorInjected) {
                        if (renderedLogs.length > 0) {
                          renderedLogs.push({ isSeparator: true, id: 'separator' });
                        }
                        separatorInjected = true;
                      }
                      renderedLogs.push(log);
                    });
                    
                    // Hook removed from here

                    return (
                      <div className="relative border-l-2 border-gray-100 ml-4 space-y-6 py-2">
                        {renderedLogs.map(log => {
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
                          
                          const timeString = new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                          const dateString = new Date(log.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
                          const isNew = lastViewed ? new Date(log.created_at) > new Date(lastViewed) : true;
                          const tag = log.action === 'workspace_deleted' ? 'Workspace' : 'Project';

                          return (
                            <div key={log.id} className={`relative pl-6 py-2 -ml-2 pr-2 rounded-xl transition-colors duration-1000 ${isNew ? 'bg-yellow-50/60 shadow-sm border border-yellow-100/50' : ''}`}>
                              {isNew && (
                                <span className="absolute top-2 right-2 flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-fuchsia-500"></span>
                                </span>
                              )}
                              <span className={`absolute -left-[14px] top-1 w-6 h-6 rounded-full bg-rose-50 border-2 border-white flex items-center justify-center shadow-xs`}>
                                <FileArchive size={14} className="text-rose-500" />
                              </span>
                              
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-100">
                                      System Archive
                                    </span>
                                    <span className="text-xs font-semibold text-gray-800">
                                      {log.details}
                                    </span>
                                  </div>
                                </div>
                                <span className="text-[9px] font-bold text-gray-400 whitespace-nowrap bg-gray-50 px-2 py-0.5 rounded-full self-start sm:self-center">
                                  {dateString} • {timeString}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                ) : (
                  <div className="text-center text-xs text-gray-400 italic py-12 border border-dashed border-gray-200 rounded-2xl">
                    No archived deletion logs found.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'deletion' && (
            <div className="max-w-xl">
              <h2 className="text-sm font-extrabold text-rose-600 uppercase tracking-wider mb-6 flex items-center gap-2">
                <Shield size={16} />
                Danger Zone: Delete Account
              </h2>
              <div className="bg-rose-50 border border-rose-100 p-6 rounded-2xl mb-8">
                <h3 className="text-sm font-bold text-rose-800 mb-2">30-Day Scheduled Deletion</h3>
                <p className="text-xs text-rose-700 leading-relaxed font-semibold">
                  When you delete your account, it will be scheduled for permanent deletion in 30 days. 
                  During this time, your profile will be hidden from the system and your tasks will be automatically reassigned.
                  If you change your mind, you can revoke the deletion by logging in within the 30-day window.
                </p>
              </div>

              <div className="space-y-8">
                {/* Normal User Flow */}
                <div className="border border-gray-200 rounded-2xl p-6">
                  <h3 className="text-sm font-bold text-gray-900 mb-1">Standard Deletion</h3>
                  <p className="text-[10px] text-gray-500 font-semibold mb-4">If you log in with an email and password, confirm deletion below.</p>
                  <form onSubmit={handleDeleteAccount} className="space-y-3">
                    <input
                      type="password"
                      placeholder="Enter your current password"
                      value={deletionPassword}
                      onChange={(e) => setDeletionPassword(e.target.value)}
                      className="w-full px-4 py-2.5 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-medium"
                      disabled={isDeleting || isOtpSent || deletionOtp.length > 0}
                    />
                    <button
                      type="submit"
                      disabled={isDeleting || !deletionPassword.trim() || isOtpSent || deletionOtp.length > 0}
                      className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                    >
                      {isDeleting ? 'Scheduling...' : 'Schedule Deletion'}
                    </button>
                  </form>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-gray-200"></div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                      OR
                    </span>
                  </div>
                </div>

                {/* Google User Flow */}
                <div className="border border-gray-200 rounded-2xl p-6">
                  <h3 className="text-sm font-bold text-gray-900 mb-1">Google Logins</h3>
                  <p className="text-[10px] text-gray-500 font-semibold mb-4">If you use Google to log in, verify your email via OTP to authorize deletion.</p>
                  
                  {!isOtpSent ? (
                    <button
                      onClick={handleRequestDeletionOtp}
                      disabled={isDeleting || deletionPassword.length > 0}
                      className="w-full py-2.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                    >
                      Request Deletion OTP
                    </button>
                  ) : (
                    <form onSubmit={handleDeleteAccount} className="space-y-3">
                      <input
                        type="text"
                        placeholder="Enter 6-digit OTP"
                        value={deletionOtp}
                        onChange={(e) => setDeletionOtp(e.target.value)}
                        className="w-full px-4 py-2.5 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-medium"
                        maxLength={6}
                        disabled={isDeleting}
                      />
                      <button
                        type="submit"
                        disabled={isDeleting || deletionOtp.length !== 6}
                        className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                      >
                        {isDeleting ? 'Scheduling...' : 'Verify OTP & Schedule Deletion'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
