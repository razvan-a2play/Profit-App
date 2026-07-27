"use client";

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@platform/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Input } from "@platform/ui";
import { Button } from "@platform/ui";
import { Label } from "@platform/ui";

// Company Google Workspace domain. The shared OAuth client's consent screen is
// "Internal", so Google itself only lets @a2playusa.com accounts through — this
// hd param just preselects the right account. Email/password stays as the
// fallback for anyone who isn't on the Workspace.
const ALLOWED_EMAIL_DOMAIN = "a2playusa.com";

// Google "G" mark, inline (no external asset).
const GoogleGlyph = () => (
  <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

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

  // Handle Supabase auth callbacks landing on /auth. We do this explicitly
  // instead of relying on the client's `detectSessionInUrl` because that
  // auto-detection has been racing with our component mount and silently
  // failing in production. Three formats to handle:
  //   1. #access_token=...&refresh_token=...&type=...   (implicit flow)
  //   2. ?code=...                                       (PKCE flow)
  //   3. ?error=... or #error=...                        (Supabase rejected)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const queryParams = new URLSearchParams(window.location.search);

    // Implicit flow — the most common case for admin-sent magic links and
    // recovery emails. We have a real access_token + refresh_token; just set
    // the session manually.
    const access_token = hashParams.get('access_token');
    const refresh_token = hashParams.get('refresh_token');
    const type = hashParams.get('type');
    if (access_token && refresh_token) {
      supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
        if (error) {
          toast({
            title: 'Sign in failed',
            description: error.message,
            variant: 'destructive',
          });
          return;
        }
        if (type === 'recovery') {
          // Strip the hash for the recovery flow (we stay on /auth to set the
          // password, no navigation needed).
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname + window.location.search
          );
          setMode('set-password');
        } else {
          // For magic-link / signup confirmation, do a full page navigation
          // to /. This forces the browser to reload, the supabase cookies are
          // sent with the request, and RequireAuth on / will see a valid
          // session immediately. Avoids any Next.js client-router race.
          const target = getReturnTarget();
          window.location.replace(target.startsWith('/') ? target : '/');
        }
      });
      return;
    }

    // PKCE flow.
    const code = queryParams.get('code');
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          toast({
            title: 'Sign in failed',
            description: error.message,
            variant: 'destructive',
          });
          return;
        }
        const target = getReturnTarget();
        window.location.replace(target.startsWith('/') ? target : '/');
      });
      return;
    }

    // Error returned in URL (e.g., otp_expired). Surface it as a toast.
    const errorDesc =
      queryParams.get('error_description') ||
      queryParams.get('error') ||
      hashParams.get('error_description') ||
      hashParams.get('error');
    if (errorDesc) {
      toast({
        title: 'Sign-in link problem',
        description: decodeURIComponent(errorDesc),
        variant: 'destructive',
      });
      const url = new URL(window.location.href);
      ['error', 'error_description', 'error_code'].forEach((p) => url.searchParams.delete(p));
      url.hash = '';
      window.history.replaceState({}, document.title, url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Google OAuth. We send the user back to /auth, where the existing
  // ?code= handler above exchanges it for a session — so no separate callback
  // route is needed. On success the browser navigates away to Google, so we
  // only clear `loading` on failure.
  const handleGoogle = async () => {
    setLoading(true);
    try {
      const from = getReturnTarget();
      const redirectTo =
        `${window.location.origin}/auth` +
        (from && from !== '/' ? `?from=${encodeURIComponent(from)}` : '');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: { hd: ALLOWED_EMAIL_DOMAIN, prompt: 'select_account' },
        },
      });
      if (error) throw error;
      // Redirecting to Google now — leave `loading` true through the handoff.
    } catch (err: any) {
      toast({ title: 'Google sign-in failed', description: err.message || 'Please try again.', variant: 'destructive' });
      setLoading(false);
    }
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
          {/* Google is the primary path for staff; the form below stays as a
              fallback. Hidden in forgot/set-password modes. */}
          {(mode === 'signin' || mode === 'signup') && (
            <div className="mb-4 space-y-3">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGoogle}
                disabled={loading}
              >
                <GoogleGlyph />
                <span className="ml-2">Continue with Google</span>
              </Button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or</span>
                </div>
              </div>
            </div>
          )}
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
