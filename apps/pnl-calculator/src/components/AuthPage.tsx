"use client";

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@platform/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Input } from "@platform/ui";
import { Button } from "@platform/ui";
import { Label } from "@platform/ui";

type AuthMode = 'signin' | 'signup' | 'forgot-password' | 'set-password';

const AuthPage: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Where to send the user after auth — honor ?from=, default to /.
  const getReturnTarget = () => {
    const raw = searchParams.get('from');
    if (!raw) return '/';
    // Only allow same-origin paths to avoid open redirects.
    if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
    return raw;
  };

  useEffect(() => {
    const titles: Record<AuthMode, string> = {
      'signin': 'Sign in • Calculator Access',
      'signup': 'Create account • Calculator Access',
      'forgot-password': 'Reset password • Calculator Access',
      'set-password': 'Choose a new password • Calculator Access',
    };
    document.title = titles[mode];
  }, [mode]);

  // Detect Supabase auth-callback markers in the URL. If present we explicitly
  // handle them so magic links / recovery / signup links work whether the
  // Site URL points at `/` or `/auth`.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // PKCE-style ?code=... callback. Supabase admin-sent links sometimes use
    // this format even when the client is configured for implicit flow.
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) {
      supabase.auth.exchangeCodeForSession(code).catch(() => {
        // Fall through — onAuthStateChange / getSession will resolve.
      });
    }

    // Surface errors that Supabase returns in the URL (?error=... or #error=...).
    const errorParam =
      new URLSearchParams(window.location.search).get('error_description') ||
      new URLSearchParams(window.location.search).get('error') ||
      new URLSearchParams(window.location.hash.replace(/^#/, '?')).get('error_description') ||
      new URLSearchParams(window.location.hash.replace(/^#/, '?')).get('error');
    if (errorParam) {
      toast({
        title: 'Sign-in link problem',
        description: decodeURIComponent(errorParam),
        variant: 'destructive',
      });
      // Strip the error from the URL so a refresh doesn't re-toast.
      const url = new URL(window.location.href);
      ['error', 'error_description', 'error_code'].forEach((p) => url.searchParams.delete(p));
      url.hash = '';
      window.history.replaceState({}, document.title, url.toString());
    }
  }, [toast]);

  // Redirect if already authenticated. Skip while we're in the middle of a
  // password-recovery flow — the recovery token signs the user in, but we
  // need to keep them on /auth so they can finish setting a new password.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || !session) return;
      const hash = typeof window !== 'undefined' ? window.location.hash : '';
      const isRecovery = hash.includes('type=recovery') || mode === 'set-password';
      if (!isRecovery) router.replace(getReturnTarget());
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for auth state changes:
  // - PASSWORD_RECOVERY → user clicked the recovery email, show set-password form
  // - SIGNED_IN (any other path, e.g. magic link) → redirect into the app
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('set-password');
        return;
      }
      if (event === 'SIGNED_IN' && session) {
        // Only auto-redirect if we're NOT in the password-set flow.
        // Recovery links also fire SIGNED_IN, but PASSWORD_RECOVERY arrives first.
        setMode((current) => {
          if (current === 'set-password') return current;
          router.replace(getReturnTarget());
          return current;
        });
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show reason if redirected here (e.g., not allowlisted)
  useEffect(() => {
    const reason = searchParams.get('reason');
    if (reason === 'not_allowlisted') {
      toast({
        title: 'Access restricted',
        description: 'Your email is not allowlisted. Please contact the administrator.',
        variant: 'destructive',
      });
      router.replace('/auth');
    }
  }, [searchParams, toast, router]);

  const cleanupAuthState = () => {
    try {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('supabase.auth.') || key.includes('sb-')) localStorage.removeItem(key);
      });
      Object.keys(sessionStorage || {}).forEach((key) => {
        if (key.startsWith('supabase.auth.') || key.includes('sb-')) sessionStorage.removeItem(key);
      });
    } catch {}
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      cleanupAuthState();
      try { await supabase.auth.signOut({ scope: 'global' }); } catch {}
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace(getReturnTarget());
    } catch (err: any) {
      toast({ title: 'Sign in failed', description: err.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/`;
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectUrl },
      });
      if (error) throw error;
      toast({ title: 'Check your email', description: 'Confirm your email to finish sign up.' });
    } catch (err: any) {
      toast({ title: 'Sign up failed', description: err.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast({ title: 'Email required', description: 'Please enter your email address.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/auth`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });
      if (error) throw error;
      toast({
        title: 'Password reset email sent',
        description: 'Check your email for a link to reset your password.'
      });
      setMode('signin');
    } catch (err: any) {
      toast({ title: 'Password reset failed', description: err.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: 'Password too short', description: 'Use at least 8 characters.', variant: 'destructive' });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: 'Passwords don’t match', description: 'Please re-enter the same password in both fields.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({ title: 'Password updated', description: 'Welcome back — redirecting you in.' });
      // Clear the recovery hash from the URL so a refresh doesn't re-trigger.
      if (typeof window !== 'undefined' && window.location.hash) {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      }
      router.replace(getReturnTarget());
    } catch (err: any) {
      toast({ title: 'Could not update password', description: err.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const onSubmit =
    mode === 'signin' ? handleSignIn :
    mode === 'signup' ? handleSignUp :
    mode === 'forgot-password' ? handleForgotPassword :
    handleSetPassword;

  const submitLabel =
    loading ? 'Please wait…' :
    mode === 'signin' ? 'Sign In' :
    mode === 'signup' ? 'Sign Up' :
    mode === 'forgot-password' ? 'Send Reset Link' :
    'Set Password';

  const headerLabel =
    mode === 'signin' ? 'Sign in to access the calculator' :
    mode === 'signup' ? 'Create an account' :
    mode === 'forgot-password' ? 'Reset your password' :
    'Choose a new password';

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-light via-background to-accent-light p-4">
      <Card className="w-full max-w-md shadow-card">
        <CardHeader>
          <CardTitle className="text-center">{headerLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            {/* Email field — hidden in set-password mode (we already know who you are) */}
            {mode !== 'set-password' && (
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            )}

            {/* Password field — shown for signin / signup / set-password */}
            {(mode === 'signin' || mode === 'signup' || mode === 'set-password') && (
              <div className="space-y-2">
                <Label htmlFor="password">
                  {mode === 'set-password' ? 'New password' : 'Password'}
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                />
              </div>
            )}

            {/* Confirm password — only in set-password mode */}
            {mode === 'set-password' && (
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {submitLabel}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground mt-4 space-y-2">
            {mode === 'signin' && (
              <>
                <button type="button" className="underline block w-full" onClick={() => setMode('forgot-password')}>Forgot password?</button>
                <button type="button" className="underline block w-full" onClick={() => setMode('signup')}>No account? Sign up</button>
              </>
            )}
            {mode === 'signup' && (
              <button type="button" className="underline" onClick={() => setMode('signin')}>Already have an account? Sign in</button>
            )}
            {mode === 'forgot-password' && (
              <button type="button" className="underline" onClick={() => setMode('signin')}>Back to sign in</button>
            )}
            {mode === 'set-password' && (
              <p className="text-xs">Pick a password you&rsquo;ll remember. After setting it you&rsquo;ll be signed in automatically.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
};

export default AuthPage;
