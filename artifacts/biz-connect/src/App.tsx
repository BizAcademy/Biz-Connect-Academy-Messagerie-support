import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { RotateCw } from 'lucide-react';
import type { Account } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import LoginPage from '@/pages/login';
import { AdminInbox } from '@/pages/inbox';
import { MemberChat } from '@/pages/member';
import { RealtimeProvider } from '@/components/realtime';
import { SummaryEffects } from '@/components/app-effects';
import { SettingsDialog } from '@/components/settings-dialog';
import { useSession } from '@/hooks/use-app';
import { Skeleton } from '@/components/ui/skeleton';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: (n, e) => n < 2 && (e as { status?: number })?.status !== 401,
    },
  },
});

function Splash() {
  return (
    <div className="flex h-[100dvh]">
      <div className="w-full space-y-4 p-4 md:w-[380px] md:border-r">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-10 w-full rounded-xl" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
      <div className="chat-wall hidden flex-1 md:block" />
    </div>
  );
}

function Authed({ account, settings }: { account: Account; settings: boolean }) {
  const [, navigate] = useLocation();
  const open = () => navigate('/settings');
  return (
    <RealtimeProvider account={account}>
      <SummaryEffects />
      {account.role === 'admin' ? (
        <AdminInbox account={account} onOpenSettings={open} />
      ) : (
        <MemberChat account={account} onOpenSettings={open} />
      )}
      <SettingsDialog open={settings} onOpenChange={(o) => !o && navigate('/')} account={account} />
    </RealtimeProvider>
  );
}

function Shell({ page }: { page: 'home' | 'login' | 'settings' }) {
  const session = useSession();
  if (session.isLoading) return <Splash />;
  if (session.isError)
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-display text-2xl">Connexion au serveur impossible</p>
        <p className="text-sm text-muted-foreground">Vérifiez votre réseau puis réessayez.</p>
        <button onClick={() => session.refetch()} className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 font-semibold text-primary-foreground" data-testid="button-retry-session">
          <RotateCw className="h-4 w-4" /> Réessayer
        </button>
      </div>
    );
  const account = session.data?.account ?? null;
  if (!account) {
    if (page === 'settings') return <Redirect to="/login" />;
    return <LoginPage session={session.data} />;
  }
  if (page === 'login') return <Redirect to="/" />;
  return <Authed account={account} settings={page === 'settings'} />;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/">{() => <Shell page="home" />}</Route>
        <Route path="/login">{() => <Shell page="login" />}</Route>
        <Route path="/settings">{() => <Shell page="settings" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
