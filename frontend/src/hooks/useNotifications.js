import { useWorkspace } from '../context/WorkspaceContext';

export function useNotifications() {
  const {
    notifications,
    markAllNotificationsRead,
    markNotificationRead,
  } = useWorkspace();

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    markAsRead: markNotificationRead,
    markAllAsRead: markAllNotificationsRead,
  };
}
export default useNotifications;
