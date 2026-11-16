import { useState } from 'react';
import { ArrowRight, BookOpen, Cloud } from 'lucide-react';
import { FcGoogle } from 'react-icons/fc';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useTranslation } from '@/hooks/useTranslation';
import type { OAuthProvider } from './ProviderLogin';

interface AuthPanelProps {
  /** Retained for older integrations; this product-owned panel does not render email auth. */
  supabaseClient?: SupabaseClient;
  redirectTo?: string;
  magicLink?: boolean;
  onProviderSignIn: (provider: OAuthProvider) => Promise<void>;
  onContinueOffline?: () => void;
}

export default function AuthPanel({ onProviderSignIn, onContinueOffline }: AuthPanelProps) {
  const _ = useTranslation();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setSignInError(null);
    try {
      await onProviderSignIn('google');
    } catch {
      setSignInError(_('Google sign-in could not start. Check your connection and try again.'));
      setIsSigningIn(false);
    }
  };

  return (
    <section className='flex w-full max-w-md flex-col gap-6'>
      <header className='flex flex-col items-center gap-4 text-center'>
        <div className='bg-primary/10 text-primary flex size-16 items-center justify-center rounded-2xl'>
          <BookOpen className='size-8' strokeWidth={1.8} aria-hidden='true' />
        </div>
        <div className='space-y-1.5'>
          <h1 className='text-primary text-2xl font-semibold tracking-tight'>
            AI Educational Book
          </h1>
          <p className='text-base-content/80 text-sm font-medium'>
            {_('Write and read your own book')}
          </p>
          <p className='text-base-content/70 text-sm leading-relaxed'>
            {_('Sign in with Google, or start writing and reading without an account.')}
          </p>
        </div>
      </header>

      <div className='flex flex-col gap-3'>
        {onContinueOffline && (
          <button
            type='button'
            className='btn btn-contrast eink-bordered flex min-h-12 w-full items-center justify-center gap-2 rounded-xl'
            onClick={onContinueOffline}
          >
            <span>{_('Start without signing in')}</span>
            <ArrowRight className='size-4' aria-hidden='true' />
          </button>
        )}

        <button
          type='button'
          onClick={() => void handleGoogleSignIn()}
          disabled={isSigningIn}
          className='btn btn-ghost eink-bordered flex min-h-12 w-full items-center justify-center gap-3 rounded-xl text-sm font-medium disabled:cursor-wait disabled:opacity-70'
        >
          <FcGoogle className='size-5' aria-hidden='true' />
          <span>{isSigningIn ? _('Opening Google sign-in…') : _('Continue with Google')}</span>
        </button>

        <div
          className='eink-bordered border-base-300 bg-base-100 flex items-center gap-3 rounded-xl border px-4 py-3'
          role='status'
          aria-label={_('BlueCloud sign-in is not connected yet.')}
        >
          <Cloud className='text-base-content/50 size-5 shrink-0' aria-hidden='true' />
          <div className='min-w-0'>
            <p className='text-sm font-medium'>{_('BlueCloud account')}</p>
            <p className='text-base-content/60 mt-0.5 text-xs leading-relaxed'>
              {_('Focus Fense account connection is being prepared.')}
            </p>
          </div>
          <span className='text-base-content/60 ms-auto shrink-0 text-xs'>{_('Coming soon')}</span>
        </div>

        {signInError && (
          <p className='text-error text-sm' role='alert'>
            {signInError}
          </p>
        )}
      </div>

      <p className='text-base-content/55 text-center text-xs leading-relaxed'>
        {_('Without an account, your writing stays on this device.')}
      </p>
    </section>
  );
}
