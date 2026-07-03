import { useEffect, useRef, useState, useCallback } from 'react';
import { getWsBase } from '../utils/api';
import { useAuth } from '../context/AuthContext';

export function useProjectWebSocket(projectId) {
  const { user } = useAuth();
  const wsRef = useRef(null);
  const [activeDrags, setActiveDrags] = useState({});

  useEffect(() => {
    if (!user || !projectId) return;

    const token = localStorage.getItem('orbit_access_token') || sessionStorage.getItem('orbit_access_token');
    if (!token) return;

    const wsUrl = `${getWsBase()}/ws/projects/${projectId}?token=${token}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.event === 'drag_start') {
          setActiveDrags(prev => ({
            ...prev,
            [message.task_id]: { userId: message.user_id, userName: message.user_name }
          }));
        } else if (message.event === 'drag_end') {
          setActiveDrags(prev => {
            const next = { ...prev };
            delete next[message.task_id];
            return next;
          });
        } else if (message.event === 'user_left') {
          setActiveDrags(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(taskId => {
              if (next[taskId].userId === message.user_id) {
                delete next[taskId];
              }
            });
            return next;
          });
        }
      } catch (err) {
        console.error('Project WS parse error:', err);
      }
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [user, projectId]);

  const broadcastEvent = useCallback((eventData) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(eventData));
    }
  }, []);

  return { activeDrags, broadcastEvent };
}
