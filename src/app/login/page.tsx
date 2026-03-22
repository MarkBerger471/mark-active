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
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-va-red/15 flex items-center justify-center">
            <svg viewBox="0 0 32 32" className="w-8 h-8 text-va-red" fill="currentColor">
              <rect x="4" y="12" width="4" height="8" rx="1" opacity="0.8" />
              <rect x="24" y="12" width="4" height="8" rx="1" opacity="0.8" />
              <rect x="2" y="13.5" width="3" height="5" rx="1" opacity="0.6" />
              <rect x="27" y="13.5" width="3" height="5" rx="1" opacity="0.6" />
              <rect x="8" y="15" width="16" height="2" rx="1" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">
            <span className="text-va-red">MARK</span> ACTIVE
          </h1>
          <div className="h-0.5 w-16 mx-auto bg-gradient-to-r from-transparent via-va-red to-transparent mt-3 rounded-full" />
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
                className="glass-input w-full px-4 py-3"
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
                className="glass-input w-full px-4 py-3"
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
