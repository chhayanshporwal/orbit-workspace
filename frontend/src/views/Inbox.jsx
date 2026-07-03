import React, { useState } from 'react';
import { useNotifications } from '../hooks/useNotifications';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAuth } from '../context/AuthContext';
import PillButton from '../components/PillButton';
import { Inbox as InboxIcon, Bell, CheckCircle, UserCheck, UserX, X } from 'lucide-react';

export default function Inbox() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const { user } = useAuth();
  const { workspaces, removeMember, deleteWorkspace, acceptInvitation, rejectInvitation } = useWorkspace();

  const [dismissedIds, setDismissedIds] = useState(() => {
    try {
      const saved = localStorage.getItem('orbit_dismissed_notifications');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const handleDismissNotification = (id, e) => {
    e.stopPropagation();
    const updated = [...dismissedIds, id];
    setDismissedIds(updated);
    localStorage.setItem('orbit_dismissed_notifications', JSON.stringify(updated));
  };

  const visibleNotifications = notifications.filter(n => !dismissedIds.includes(n.id));

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

  return (
    <div className="p-8 max-w-4xl mx-auto font-sans">
      <div className="pb-6 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 flex items-center gap-2">
            <InboxIcon className="text-fuchsia-600" size={24} />
            Inbox
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Real-time activity log and notifications.
          </p>
        </div>
        {unreadCount > 0 && (
          <PillButton variant="secondary" size="sm" onClick={markAllAsRead}>
            Mark all as read
          </PillButton>
        )}
      </div>

      <div className="mt-8 border border-gray-200 rounded-2xl bg-white shadow-xs divide-y divide-gray-100 overflow-hidden">
        {visibleNotifications.map((n) => (
          <div
            key={n.id}
            onClick={() => markAsRead(n.id)}
            className={`p-5 flex items-start justify-between gap-4 hover:bg-gray-50/50 transition-colors cursor-pointer ${
              !n.read ? 'bg-fuchsia-50/10' : ''
            }`}
          >
            <div className="flex gap-3 items-start">
              <div className={`p-2 rounded-full shrink-0 ${!n.read ? 'bg-fuchsia-100 text-fuchsia-600' : 'bg-gray-100 text-gray-400'}`}>
                <Bell size={16} />
              </div>
              <div>
                <h3 className={`text-sm ${!n.read ? 'font-extrabold text-gray-900' : 'font-semibold text-gray-700'}`}>
                  {n.title}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.message}</p>
                
                {n.message?.startsWith('You were invited to workspace:') && !n.read && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await handleAcceptInvite(n);
                      }}
                      className="px-3 py-1.5 bg-fuchsia-600 hover:bg-fuchsia-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1"
                    >
                      <UserCheck size={12} /> Accept Invite
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await handleRejectInvite(n);
                      }}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                    >
                      <UserX size={12} /> Reject
                    </button>
                  </div>
                )}

                 {n.message?.includes('requests to leave workspace:') && !n.read && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await handleApproveLeave(n);
                      }}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1"
                    >
                      <UserCheck size={12} /> Approve Leave
                    </button>
                     <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await markAsRead(n.id, 'dismissed');
                      }}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                    >
                      <UserX size={12} /> Dismiss
                    </button>
                  </div>
                )}

                {n.message?.includes('requests to delete workspace:') && !n.read && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await handleApproveDelete(n);
                      }}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1"
                    >
                      <UserCheck size={12} /> Approve Delete
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await markAsRead(n.id, 'dismissed');
                      }}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                    >
                      <UserX size={12} /> Dismiss
                    </button>
                  </div>
                )}

                <span className="text-[10px] font-bold text-gray-400 mt-1.5 block">{n.time}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0 self-center">
              {!n.read && (
                <span className="w-2 h-2 rounded-full bg-fuchsia-600" title="Unread"></span>
              )}
              <button
                onClick={(e) => handleDismissNotification(n.id, e)}
                className="p-1.5 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                title="Dismiss/Soft Delete"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}

        {visibleNotifications.length === 0 && (
          <div className="p-12 text-center text-gray-400 flex flex-col items-center justify-center gap-2">
            <CheckCircle size={32} className="text-gray-200" />
            <span className="text-sm font-semibold">You're all caught up!</span>
          </div>
        )}
      </div>
    </div>
  );
}
