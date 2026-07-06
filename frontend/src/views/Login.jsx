import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PillButton from '../components/PillButton';
import Modal from '../components/Modal';
import { Compass, KeyRound, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { api } from '../utils/api';

export default function Login() {
  const { login, error, setError, fetchProfile } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const [showSavedAccounts, setShowSavedAccounts] = useState(true);

  // Retrieve saved accounts from localStorage
  const [savedAccounts, setSavedAccounts] = useState(() => {
    const savedAccountsStr = localStorage.getItem('orbit_saved_accounts');
    return savedAccountsStr ? JSON.parse(savedAccountsStr) : [];
  });

  useEffect(() => {
    const validateTokens = async () => {
      let validAccounts = [];
      let changed = false;
      const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '/api';
      
      for (const acc of savedAccounts) {
        try {
          const res = await fetch(`${API_BASE}/users/me`, {
            headers: { Authorization: `Bearer ${acc.token}` }
          });
          if (res.ok) {
            validAccounts.push(acc);
          } else {
            changed = true;
          }
        } catch {
          changed = true; // network error or token is invalid
        }
      }
      if (changed) {
        localStorage.setItem('orbit_saved_accounts', JSON.stringify(validAccounts));
        setSavedAccounts(validAccounts);
        if (validAccounts.length === 0) setShowSavedAccounts(false);
      }
    };
    if (savedAccounts.length > 0) {
      validateTokens();
    }
  }, []);

  const handleSavedAccountLogin = async (acc) => {
    setLoading(true);
    setError(null);
    try {
      localStorage.setItem('orbit_access_token', acc.token);
      sessionStorage.removeItem('orbit_access_token');
      await fetchProfile();
      navigate('/workspaces');
    } catch (err) {
      setError('Session expired or revoked. Please sign in again.');
      // Remove expired account from list
      const updated = savedAccounts.filter(a => a.email.toLowerCase() !== acc.email.toLowerCase());
      localStorage.setItem('orbit_saved_accounts', JSON.stringify(updated));
      setSavedAccounts(updated);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveSavedAccount = (emailToRemove, e) => {
    e.stopPropagation();
    const updated = savedAccounts.filter(a => a.email.toLowerCase() !== emailToRemove.toLowerCase());
    localStorage.setItem('orbit_saved_accounts', JSON.stringify(updated));
    setSavedAccounts(updated);
    if (updated.length === 0) {
      setShowSavedAccounts(false);
    }
  };

  // Forgot Password States
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [forgotStage, setForgotStage] = useState('email'); // 'email', 'otp', 'reset'
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');
  const [forgotResendCooldown, setForgotResendCooldown] = useState(0);

  React.useEffect(() => {
    if (forgotResendCooldown > 0) {
      const timer = setTimeout(() => setForgotResendCooldown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [forgotResendCooldown]);

  const handleResendForgot = async () => {
    if (forgotResendCooldown > 0) return;
    setForgotError('');
    setForgotSuccess('');
    try {
      await api.post('/forgot-password', { email: forgotEmail });
      setForgotSuccess('Recovery code resent successfully!');
      setForgotResendCooldown(30);
    } catch (err) {
      setForgotError(err.message || 'Failed to resend code');
    }
  };

  // Email Verification states
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyEmailAddress, setVerifyEmailAddress] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifySuccess, setVerifySuccess] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  React.useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleResendVerify = async () => {
    if (resendCooldown > 0) return;
    setVerifyError('');
    setVerifySuccess('');
    try {
      await api.post('/resend-verification', { email: verifyEmailAddress });
      setVerifySuccess('Verification code resent successfully!');
      setResendCooldown(30);
    } catch (err) {
      setVerifyError(err.message || 'Failed to resend code');
    }
  };

  // Deletion Revocation states
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const getPasswordStrength = (p) => {
    return {
      length: p.length >= 8,
      number: /\d/.test(p),
      upper: /[A-Z]/.test(p),
      special: /[!@#$%^&*(),.?":{}|<>]/.test(p),
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const devId = localStorage.getItem('orbit_device_id') || 'unknown_device';
      const devName = navigator.userAgent || 'Unknown Browser';
      const res = await login(email, password, devId, devName);
      if (res.status === 'success') {
        navigate('/workspaces');
      } else if (res.status === 'deletion_pending') {
        setShowRevokeModal(true);
      } else if (res.status === 'unverified') {
        setVerifyEmailAddress(email);
        setVerificationCode('');
        setVerifyError('');
        setVerifySuccess('');
        setShowVerifyModal(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmail = async (e) => {
    e.preventDefault();
    setVerifyError('');
    setVerifySuccess('');
    try {
      const res = await api.post('/verify-email', { email: verifyEmailAddress, code: verificationCode });
      localStorage.setItem('orbit_access_token', res.access_token);
      await fetchProfile();
      setVerifySuccess('Email verified successfully! You can now log in.');
      window.dispatchEvent(new CustomEvent('orbit-toast', { detail: { type: 'success', message: 'Email verified! Logging in...' } }));
      setTimeout(() => {
        setShowVerifyModal(false);
        navigate('/workspaces');
      }, 1000);
    } catch (err) {
      setVerifyError(err.message || 'Failed to verify email.');
    }
  };

  const handleGoogleLogin = () => {
    const redirectUri = `${window.location.origin}/oauth-callback`;
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'mock-google-client-id'; 
    
    if (clientId === 'mock-google-client-id') {
      // Mock redirect flow
      navigate(`/oauth-callback?code=mock-google-code`);
    } else {
      const scope = 'openid email profile';
      const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}`;
      window.location.href = googleAuthUrl;
    }
  };

  const isOneClickView = savedAccounts.length > 0 && showSavedAccounts;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans relative">
      <Link to="/" className="absolute top-6 left-6 sm:top-8 sm:left-8 flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Home
      </Link>
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-fuchsia-600 flex items-center justify-center text-white shadow-md shadow-fuchsia-500/30">
          <Compass size={24} />
        </div>
        <h2 className="mt-6 text-3xl font-extrabold tracking-tight text-gray-900">
          Welcome to Orbit
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {isOneClickView ? (
            'Select an account to log in with one click'
          ) : (
            <>
              Or{' '}
              <Link to="/register" className="font-extrabold text-fuchsia-600 hover:text-fuchsia-500">
                create a new account
              </Link>
            </>
          )}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 border border-gray-200 shadow-sm rounded-2xl sm:px-10">
          {isOneClickView ? (
            <div className="space-y-6">
              <div className="space-y-3">
                {savedAccounts.map((acc) => (
                  <div 
                    key={acc.email}
                    onClick={() => handleSavedAccountLogin(acc)}
                    className="flex items-center justify-between p-3.5 rounded-xl border border-gray-100 hover:border-fuchsia-200 bg-white hover:bg-fuchsia-50/10 cursor-pointer transition-all hover:scale-[1.01] hover:shadow-xs group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-fuchsia-100 text-fuchsia-600 flex items-center justify-center font-bold text-sm">
                        {acc.initials || acc.email.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-extrabold text-gray-900">{acc.name}</div>
                        <div className="text-xs text-gray-500 font-medium">{acc.email}</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-fuchsia-600 uppercase tracking-wider bg-fuchsia-50 px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
                        One-Click Sign In
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleRemoveSavedAccount(acc.email, e)}
                        className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-red-500 transition-colors"
                        title="Remove account"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {error && (
                <div className="p-3 bg-red-50 rounded-2xl border border-red-200 text-center">
                  <p className="text-xs font-bold text-red-600">{error}</p>
                </div>
              )}

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs font-bold uppercase tracking-wider">
                  <span className="px-2 bg-white text-gray-400">Or</span>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setShowSavedAccounts(false)}
                  className="w-full py-3 px-4 border border-gray-200 hover:border-gray-300 rounded-full bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 transition-all flex items-center justify-center gap-1.5"
                >
                  Log In to Another Account
                </button>
              </div>
            </div>
          ) : (
            <>
              <form className="space-y-6" onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="email" className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider">
                    Email address
                  </label>
                  <div className="mt-1">
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full px-5 py-3 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-sm font-medium transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider">
                    Password
                  </label>
                  <div className="mt-1 relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-5 py-3 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-sm font-medium transition-all pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-fuchsia-600 transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-red-50 rounded-2xl border border-red-200 text-center">
                    <p className="text-xs font-bold text-red-600">{error}</p>
                  </div>
                )}

                <div>
                  <PillButton
                    type="submit"
                    variant="primary"
                    className="w-full py-3"
                    disabled={loading}
                  >
                    {loading ? 'Signing in...' : 'Sign In'}
                  </PillButton>
                </div>

                <div className="flex justify-center text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotStage('email');
                      setForgotOtp('');
                      setNewPassword('');
                      setConfirmNewPassword('');
                      setForgotError('');
                      setForgotSuccess('');
                      setShowForgotModal(true);
                    }}
                    className="font-extrabold text-fuchsia-600 hover:text-fuchsia-500"
                  >
                    Forgot password?
                  </button>
                </div>
              </form>

              {/* Social Logins */}
              <div className="mt-6">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-xs font-bold uppercase tracking-wider">
                    <span className="px-2 bg-white text-gray-400">Or continue with</span>
                  </div>
                </div>

                <div className="mt-6">
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    className="w-full inline-flex justify-center py-2.5 px-4 border border-gray-200 rounded-full bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 transition-all flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114A5.99 5.99 0 018 12.5a5.99 5.99 0 015.99-6.027c1.558 0 2.978.593 4.053 1.564l3.153-3.152C19.227 3.037 16.797 2 13.99 2 8.48 2 4 6.48 4 12s4.48 10 9.99 10c5.38 0 9.86-3.87 9.86-10 0-.67-.07-1.3-.19-1.715h-11.42z" />
                    </svg>
                    Google
                  </button>
                </div>
              </div>

              {savedAccounts.length > 0 && (
                <div className="text-center text-xs mt-6 border-t border-gray-100 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowSavedAccounts(true)}
                    className="font-extrabold text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    ← Back to saved accounts
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Forgot Password Flow Modal */}
      <Modal
        isOpen={showForgotModal}
        onClose={() => setShowForgotModal(false)}
        title="Account Recovery"
      >
        <div className="font-sans text-left space-y-4">
          {forgotStage === 'email' && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setForgotError('');
                setForgotSuccess('');
                try {
                  await api.post('/forgot-password', { email: forgotEmail });
                  setForgotStage('otp');
                } catch (err) {
                  setForgotError(err.message || 'Failed to send recovery code.');
                }
              }}
              className="space-y-4"
            >
              <div className="p-3.5 bg-fuchsia-50/50 border border-fuchsia-100 rounded-2xl text-xs text-fuchsia-800 font-semibold leading-relaxed">
                🔑 Enter your registered email address to receive a 6-digit verification code.
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full px-4 py-2.5 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 text-xs font-semibold"
                />
              </div>
              {forgotError && <p className="text-[10px] font-bold text-red-500 mt-1">{forgotError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <PillButton variant="ghost" onClick={() => setShowForgotModal(false)}>
                  Cancel
                </PillButton>
                <PillButton type="submit" variant="primary">
                  Send Recovery Code
                </PillButton>
              </div>
            </form>
          )}

          {forgotStage === 'otp' && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setForgotError('');
                if (forgotOtp.length !== 6) {
                  setForgotError('Please enter a valid 6-digit code.');
                  return;
                }
                try {
                  await api.post('/verify-reset-otp', { email: forgotEmail, otp: forgotOtp });
                  setForgotStage('reset');
                } catch (err) {
                  setForgotError(err.message || 'Verification failed. Invalid or expired OTP.');
                }
              }}
              className="space-y-4"

            >
              <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-2xl text-xs text-indigo-800 font-semibold leading-relaxed">
                ✉️ A 6-digit OTP code has been dispatched to your email <strong className="font-bold">{forgotEmail}</strong>.
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">
                  6-Digit OTP Code
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={forgotOtp}
                  onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 123456"
                  className="w-full px-4 py-2.5 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 text-xs font-bold text-center tracking-widest text-lg"
                />
              </div>
              {forgotError && <p className="text-[10px] font-bold text-red-500 mt-1">{forgotError}</p>}
              {forgotSuccess && <p className="text-[10px] font-bold text-green-600 mt-1">{forgotSuccess}</p>}
              
              <div className="text-center mt-2">
                <button
                  type="button"
                  onClick={handleResendForgot}
                  disabled={forgotResendCooldown > 0}
                  className="text-[10px] font-bold text-fuchsia-600 hover:text-fuchsia-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {forgotResendCooldown > 0 ? `Resend code in ${forgotResendCooldown}s` : 'Resend recovery code'}
                </button>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <PillButton variant="ghost" onClick={() => setForgotStage('email')}>
                  Back
                </PillButton>
                <PillButton type="submit" variant="primary">
                  Verify Code
                </PillButton>
              </div>
            </form>
          )}

          {forgotStage === 'reset' && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (newPassword !== confirmNewPassword) {
                  setForgotError('Passwords do not match.');
                  return;
                }
                const str = getPasswordStrength(newPassword);
                if (!str.length || !str.number || !str.upper || !str.special) {
                  setForgotError('Password does not meet complexity requirements.');
                  return;
                }
                setForgotError('');
                try {
                  await api.post('/reset-password', {
                    email: forgotEmail,
                    otp: forgotOtp,
                    new_password: newPassword
                  });
                  setForgotSuccess('Password successfully reset! You can now log in.');
                  window.dispatchEvent(new CustomEvent('orbit-toast', { detail: { type: 'success', message: 'Password updated successfully!' } }));
                  setTimeout(() => {
                    setShowForgotModal(false);
                  }, 2000);
                } catch (err) {
                  setForgotError(err.message || 'Failed to reset password.');
                }
              }}
              className="space-y-4"
            >
              <div className="p-3.5 bg-emerald-50/50 border border-emerald-100 rounded-2xl text-xs text-emerald-800 font-semibold leading-relaxed">
                🔒 Security Verified. Please establish your complex new security credentials.
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2.5 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 text-xs font-semibold pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-fuchsia-600 transition-colors"
                  >
                    {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                {/* Real-time policy requirements list */}
                <div className="mt-2.5 grid grid-cols-2 gap-2 text-[9px] font-bold">
                  <span className={getPasswordStrength(newPassword).length ? 'text-green-600' : 'text-gray-400'}>
                    ✓ Min 8 Characters
                  </span>
                  <span className={getPasswordStrength(newPassword).number ? 'text-green-600' : 'text-gray-400'}>
                    ✓ Contains 1 Number
                  </span>
                  <span className={getPasswordStrength(newPassword).upper ? 'text-green-600' : 'text-gray-400'}>
                    ✓ 1 Uppercase Letter
                  </span>
                  <span className={getPasswordStrength(newPassword).special ? 'text-green-600' : 'text-gray-400'}>
                    ✓ 1 Special Character
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmNewPassword ? 'text' : 'password'}
                    required
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2.5 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 text-xs font-semibold pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-fuchsia-600 transition-colors"
                  >
                    {showConfirmNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {forgotError && <p className="text-[10px] font-bold text-red-500 mt-1">{forgotError}</p>}
              {forgotSuccess && <p className="text-[10px] font-bold text-green-600 mt-1">{forgotSuccess}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <PillButton type="submit" variant="primary" className="w-full">
                  Update Account Password
                </PillButton>
              </div>
            </form>
          )}
        </div>
      </Modal>

      {/* Email Verification Modal */}
      <Modal
        isOpen={showVerifyModal}
        onClose={() => setShowVerifyModal(false)}
        title="Email Verification"
      >
        <form onSubmit={handleVerifyEmail} className="font-sans text-left space-y-4">
          <div className="p-3.5 bg-fuchsia-50/50 border border-fuchsia-100 rounded-2xl text-xs text-fuchsia-800 font-semibold leading-relaxed">
            ✉️ An email verification code was sent to <strong className="font-bold">{verifyEmailAddress}</strong>.
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">
              Verification Code
            </label>
            <input
              type="text"
              required
              maxLength={6}
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
              placeholder="e.g. 123456"
              className="w-full px-4 py-2.5 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 text-xs font-bold text-center tracking-widest text-lg"
            />
          </div>

          {verifyError && <p className="text-[10px] font-bold text-red-500">{verifyError}</p>}
          {verifySuccess && <p className="text-[10px] font-bold text-green-600">{verifySuccess}</p>}

          <div className="text-center mt-2">
            <button
              type="button"
              onClick={handleResendVerify}
              disabled={resendCooldown > 0}
              className="text-[10px] font-bold text-fuchsia-600 hover:text-fuchsia-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend verification code'}
            </button>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <PillButton variant="ghost" onClick={() => setShowVerifyModal(false)}>
              Cancel
            </PillButton>
            <PillButton type="submit" variant="primary">
              Verify Email
            </PillButton>
          </div>
        </form>
      </Modal>

      {/* Revoke Deletion Modal */}
      <Modal
        isOpen={showRevokeModal}
        onClose={() => {
          setShowRevokeModal(false);
          setError('Account deletion is pending. Please revoke to log in.');
        }}
        title="Account Scheduled for Deletion"
      >
        <div className="font-sans text-left space-y-4">
          <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl">
            <h3 className="text-sm font-bold text-rose-800 mb-2">Deletion Pending</h3>
            <p className="text-xs text-rose-700 leading-relaxed font-semibold">
              This account is currently scheduled for permanent deletion. 
              Would you like to revoke this request and restore your account?
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <PillButton 
              type="button" 
              variant="primary" 
              className="w-full bg-emerald-600 hover:bg-emerald-700 !text-white"
              disabled={revokeLoading}
              onClick={async () => {
                setRevokeLoading(true);
                try {
                  await api.post('/revoke-deletion');
                  setShowRevokeModal(false);
                  await fetchProfile();
                  navigate('/workspaces');
                } catch (err) {
                  setError(err.message || 'Failed to revoke deletion.');
                  setShowRevokeModal(false);
                } finally {
                  setRevokeLoading(false);
                }
              }}
            >
              {revokeLoading ? 'Restoring...' : 'Yes, Restore My Account'}
            </PillButton>
            <PillButton 
              variant="ghost" 
              className="w-full text-gray-500"
              onClick={() => {
                setShowRevokeModal(false);
                setError('Account deletion is pending. Please revoke to log in.');
              }}
            >
              No, leave it scheduled for deletion
            </PillButton>
          </div>
        </div>
      </Modal>


    </div>
  );
}
