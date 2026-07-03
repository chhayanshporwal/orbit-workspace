import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PillButton from '../components/PillButton';
import { Compass, Eye, EyeOff } from 'lucide-react';
import { api } from '../utils/api';

export default function Register() {
  const { register, error, setError } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [isVerifyPending, setIsVerifyPending] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifySuccess, setVerifySuccess] = useState('');
  const navigate = useNavigate();

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
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    const strength = getPasswordStrength(password);
    if (!strength.length || !strength.number || !strength.upper || !strength.special) {
      setError('Password does not meet complexity requirements');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess('');
    try {
      await register(email, password, name);
      setIsVerifyPending(true);
    } catch (e) {
      setError(e.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };


  if (isVerifyPending) {
    const handleVerify = async (e) => {
      e.preventDefault();
      setVerifyError('');
      setVerifySuccess('');
      try {
        await api.post('/verify-email', { email, code: verificationCode });
        setVerifySuccess('Email verified successfully! Redirecting to login...');
        setTimeout(() => {
          navigate('/login');
        }, 2000);
      } catch (err) {
        setVerifyError(err.message || 'Failed to verify email.');
      }
    };

    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-fuchsia-600 flex items-center justify-center text-white shadow-md shadow-fuchsia-500/30">
            <Compass size={24} />
          </div>
          <h2 className="mt-6 text-3xl font-extrabold tracking-tight text-gray-900">
            Account Verification
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Enter the 6-digit code sent to <strong className="font-bold text-gray-700">{email}</strong>.
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 border border-gray-200 shadow-sm rounded-2xl sm:px-10 text-center space-y-6">
            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1 text-left">
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

              <PillButton type="submit" variant="primary" className="w-full py-2.5">
                Verify & Activate
              </PillButton>
            </form>

            <div className="border-t border-gray-100 pt-4 flex flex-col gap-2">
              <PillButton
                variant="ghost"
                className="w-full py-2"
                onClick={() => {
                  alert('To request a new verification code, please try to sign in with your email/password on the login screen.');
                  navigate('/login');
                }}
              >
                Back to Sign In
              </PillButton>
            </div>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-fuchsia-600 flex items-center justify-center text-white shadow-md shadow-fuchsia-500/30">
          <Compass size={24} />
        </div>
        <h2 className="mt-6 text-3xl font-extrabold tracking-tight text-gray-900">
          Create account
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          Or{' '}
          <Link to="/login" className="font-extrabold text-fuchsia-600 hover:text-fuchsia-500">
            sign in to your account
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 border border-gray-200 shadow-sm rounded-2xl sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="name" className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider">
                Full Name
              </label>
              <div className="mt-1">
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-5 py-3 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-sm font-medium transition-all"
                />
              </div>
            </div>

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
                
                {/* Real-time policy requirements list */}
                <div className="mt-2.5 grid grid-cols-2 gap-2 text-[9px] font-bold">
                  <span className={getPasswordStrength(password).length ? 'text-green-600' : 'text-gray-400'}>
                    ✓ Min 8 Characters
                  </span>
                  <span className={getPasswordStrength(password).number ? 'text-green-600' : 'text-gray-400'}>
                    ✓ Contains 1 Number
                  </span>
                  <span className={getPasswordStrength(password).upper ? 'text-green-600' : 'text-gray-400'}>
                    ✓ 1 Uppercase Letter
                  </span>
                  <span className={getPasswordStrength(password).special ? 'text-green-600' : 'text-gray-400'}>
                    ✓ 1 Special Character
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider">
                Confirm Password
              </label>
              <div className="mt-1 relative">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-5 py-3 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-sm font-medium transition-all pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-fuchsia-600 transition-colors"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 rounded-2xl border border-red-200 text-center">
                <p className="text-xs font-bold text-red-600">{error}</p>
              </div>
            )}

            {success && (
              <div className="p-3 bg-green-50 rounded-2xl border border-green-200 text-center">
                <p className="text-xs font-bold text-green-600">{success}</p>
              </div>
            )}

            <div>
              <PillButton
                type="submit"
                variant="primary"
                className="w-full py-3"
                disabled={loading}
              >
                {loading ? 'Creating...' : 'Create Account'}
              </PillButton>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
