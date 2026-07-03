import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../utils/api';

const AuthContext = createContext(null);



export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchProfile = async () => {
    try {
      const profile = await api.get('/users/me');
      if (profile) {
        const displayName = profile.name || profile.email.split('@')[0];
        const finalInitials = profile.name 
          ? profile.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
          : profile.email.substring(0, 2).toUpperCase();
        
        const userData = {
          id: profile.id,
          email: profile.email,
          name: displayName,
          initials: finalInitials,
          globalRole: 'Editor',
        };
        setUser(userData);
        return userData;
      }
    } catch (e) {
      logout();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('orbit_access_token') || sessionStorage.getItem('orbit_access_token');
    if (token) {
      fetchProfile();
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password, deviceId = 'unknown_device', deviceName = 'Unknown Browser') => {
    setError(null);
    try {
      const res = await api.post('/login', {
        username: email,
        password,
        device_id: deviceId,
        device_name: deviceName
      }, true);
      
      if (res && res.access_token) {
        // By default, save to sessionStorage (short-lived session)
        sessionStorage.setItem('orbit_access_token', res.access_token);
        localStorage.removeItem('orbit_access_token');
        
        if (res.deletion_scheduled_at) {
          return { status: 'deletion_pending' };
        }
        
        await fetchProfile();
        return { status: 'success' };
      }
    } catch (e) {
      if (e.message === 'Email not verified') {
        return { status: 'unverified', email };
      }
      setError(e.message || 'Incorrect email or password');
      return { status: 'error' };
    }
    return { status: 'error' };
  };

  const rememberDevice = async (deviceId, deviceName) => {
    try {
      const res = await api.post('/auth/remember-device', {
        device_id: deviceId,
        device_name: deviceName
      });
      if (res && res.access_token) {
        // Upgrade to localStorage (persisted session)
        localStorage.setItem('orbit_access_token', res.access_token);
        sessionStorage.removeItem('orbit_access_token');
        const activeUser = await fetchProfile();
        if (activeUser) {
          const savedAccountsStr = localStorage.getItem('orbit_saved_accounts');
          let savedAccounts = savedAccountsStr ? JSON.parse(savedAccountsStr) : [];
          // Remove any duplicate for this email
          savedAccounts = savedAccounts.filter(acc => acc.email.toLowerCase() !== activeUser.email.toLowerCase());
          // Push new saved account
          savedAccounts.push({
            email: activeUser.email,
            name: activeUser.name,
            initials: activeUser.initials,
            token: res.access_token
          });
          localStorage.setItem('orbit_saved_accounts', JSON.stringify(savedAccounts));
        }
        return true;
      }
    } catch (e) {
      console.error('Failed to remember device:', e);
    }
    return false;
  };

  const register = async (email, password, name) => {
    setError(null);
    try {
      await api.post('/users/', { email, password, name });
      return { status: 'unverified', email };
    } catch (e) {
      setError(e.message || 'Registration failed');
      return { status: 'error' };
    }
  };

  const logout = async () => {
    const token = localStorage.getItem('orbit_access_token') || sessionStorage.getItem('orbit_access_token');
    const savedAccountsStr = localStorage.getItem('orbit_saved_accounts');
    const savedAccounts = savedAccountsStr ? JSON.parse(savedAccountsStr) : [];
    
    // Check if the current user is saved in the remember list
    const isSaved = user && savedAccounts.some(acc => acc.email.toLowerCase() === user.email.toLowerCase());

    if (token && !isSaved) {
      try {
        await api.post('/logout');
      } catch (e) {
        // ignore logout errors
      }
    }
    localStorage.removeItem('orbit_access_token');
    sessionStorage.removeItem('orbit_access_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, rememberDevice, register, logout, error, setError, fetchProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
