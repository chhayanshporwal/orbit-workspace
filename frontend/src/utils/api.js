// In production (Docker/Nginx), requests are proxied via /api/ -> backend:8000/
// In dev (vite), requests go directly to http://localhost:8000
const IS_DEV = import.meta.env.DEV;
const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(endpoint, options = {}) {
  const token = localStorage.getItem('orbit_access_token') || sessionStorage.getItem('orbit_access_token');
  
  const headers = {
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, config);

  if (!response.ok) {
    let errorMessage = 'Something went wrong';
    try {
      const errorData = await response.json();
      if (typeof errorData.detail === 'string') {
        errorMessage = errorData.detail;
      } else if (Array.isArray(errorData.detail) && errorData.detail.length > 0) {
        errorMessage = errorData.detail[0].msg || errorMessage;
      } else {
        errorMessage = errorData.message || errorMessage;
      }
    } catch (e) {
      // response wasn't json
    }
    
    // Log meaningful details for production monitoring/debugging
    console.error(`🚨 API Error [${options.method || 'GET'} ${endpoint}]: ${response.status} ${response.statusText}`);
    console.error(`🚨 Backend Response: ${errorMessage}`);
    
    // Dispatch global toast error event
    window.dispatchEvent(new CustomEvent('orbit-toast', {
      detail: { type: 'error', message: errorMessage }
    }));

    throw new Error(errorMessage);
  }

  // Some delete routes might return status 204 or no content
  if (response.status === 204) {
    return null;
  }

  try {
    return await response.json();
  } catch (e) {
    return null;
  }
}

export const api = {
  get: (endpoint) => request(endpoint, { method: 'GET' }),
  
  post: (endpoint, body, isUrlEncoded = false) => {
    const headers = {};
    let finalBody;

    if (isUrlEncoded) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        params.append(key, value);
      }
      finalBody = params.toString();
    } else {
      headers['Content-Type'] = 'application/json';
      finalBody = JSON.stringify(body);
    }

    return request(endpoint, {
      method: 'POST',
      headers,
      body: finalBody,
    });
  },

  put: (endpoint, body) => request(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }),

  delete: (endpoint) => request(endpoint, { method: 'DELETE' }),
};

// Helper to get the WebSocket base URL
export function getWsBase() {
  return import.meta.env.VITE_WS_URL || (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host;
}

export default api;
