import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import CaseList from '@/pages/cases/CaseList';
import CaseWorkspace from '@/pages/cases/CaseWorkspace';
import CaseDisclosureWorkbench from '@/pages/cases/CaseDisclosureWorkbench';
import Landing from '@/pages/Landing';
import { isUnlocked } from '@/lib/access';

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/cases" component={CaseList} />
          <Route path="/cases/:id/disclosure" component={CaseDisclosureWorkbench} />
          <Route path="/cases/:id" component={CaseWorkspace} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </AppLayout>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  const [unlocked, setUnlocked] = useState(isUnlocked);

  // Force dark mode on mount
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        {unlocked ? (
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        ) : (
          <Landing onUnlock={() => setUnlocked(true)} />
        )}
        <Toaster theme="dark" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;