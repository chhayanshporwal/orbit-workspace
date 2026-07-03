import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { Compass } from 'lucide-react';

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fetchProfile, setError } = useAuth();
  const [status, setStatus] = useState('authenticating');

  const hasExchanged = React.useRef(false);

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      setError('OAuth error: Authorization code missing.');
      navigate('/login');
      return;
    }

    if (hasExchanged.current) {
      return;
    }
    hasExchanged.current = true;

    const exchangeCode = async () => {
      try {
        const redirectUri = `${window.location.origin}/oauth-callback`;
        const res = await api.post('/auth/google', { code, redirect_uri: redirectUri });
        
        if (res && res.access_token) {
          // Store token in sessionStorage by default
          sessionStorage.setItem('orbit_access_token', res.access_token);
          localStorage.removeItem('orbit_access_token');
          
          await fetchProfile();
          navigate('/workspaces');
        } else {
          throw new Error('No access token returned.');
        }
      } catch (err) {
        console.error('OAuth exchange error:', err);
        setError(err.message || 'OAuth authentication failed.');
        navigate('/login');
      }
    };

    exchangeCode();
  }, [searchParams, fetchProfile, navigate, setError]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center font-sans">
      <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg animate-bounce">
        <Compass size={24} className="animate-spin" />
      </div>
      <p className="mt-4 text-xs font-bold text-gray-400 uppercase tracking-wider animate-pulse">
        Verifying credentials with Google...
      </p>
    </div>
  );
}
