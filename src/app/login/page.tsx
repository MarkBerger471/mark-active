'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name || !password) {
      setError('Please fill in all fields');
      return;
    }

    const success = login(name, password);
    if (success) {
      router.push('/');
    } else {
      setError('Invalid password');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-va-red/15 flex items-center justify-center shadow-[0_0_30px_rgba(185,10,10,0.4),0_0_60px_rgba(185,10,10,0.15)] border border-va-red/20">
            <svg viewBox="0 0 32 32" className="w-10 h-10 text-va-red drop-shadow-[0_0_8px_rgba(185,10,10,0.6)]" fill="currentColor">
              <rect x="4" y="12" width="4" height="8" rx="1" opacity="0.8" />
              <rect x="24" y="12" width="4" height="8" rx="1" opacity="0.8" />
              <rect x="2" y="13.5" width="3" height="5" rx="1" opacity="0.6" />
              <rect x="27" y="13.5" width="3" height="5" rx="1" opacity="0.6" />
              <rect x="8" y="15" width="16" height="2" rx="1" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">
            <span className="text-va-red" style={{ textShadow: '0 0 20px rgba(185,10,10,0.5)' }}>MARK</span> ACTIVE
          </h1>
          <div className="h-1 w-20 mx-auto bg-gradient-to-r from-transparent via-va-red to-transparent mt-3 rounded-full shadow-[0_0_10px_rgba(185,10,10,0.4)]" />
          <p className="text-va-gray-dark tracking-widest uppercase text-sm mt-3">Body Tracker</p>
        </div>

        <div className="glass-strong p-8">
          <h2 className="text-xl font-semibold text-white mb-6">Sign In</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-white/60 mb-2">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="glass-input w-full px-4 py-3 focus:shadow-[0_0_15px_rgba(185,10,10,0.2)] focus:border-va-red/30 transition-shadow"
                placeholder="Your name"
                autoComplete="name"
              />
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="glass-input w-full px-4 py-3 focus:shadow-[0_0_15px_rgba(185,10,10,0.2)] focus:border-va-red/30 transition-shadow"
                placeholder="Enter password"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="text-va-red text-sm">{error}</p>
            )}

            <button type="submit" className="btn-primary w-full text-center">
              Sign In
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
