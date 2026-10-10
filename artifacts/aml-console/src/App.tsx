import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import RulePerformancePage from '@/pages/analytics/RulePerformance';
import CounterpartyIntelPage from '@/pages/analytics/CounterpartyIntel';
import AboutPage from '@/pages/about/AboutPage';
import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import CaseList from '@/pages/cases/CaseList';
import CaseWorkspace from '@/pages/cases/CaseWorkspace';
import CaseDisclosureWorkbench from '@/pages/cases/CaseDisclosureWorkbench';
import CaseNetwork from '@/pages/cases/CaseNetwork';
import DeclarationIntakePage from '@/pages/intake/DeclarationIntakePage';
import DeclarationReviewPage from '@/pages/intake/DeclarationReviewPage';
import Landing from '@/pages/Landing';
import { isUnlocked } from '@/lib/access';

// Client errors (a 404 for "no analysis yet", a 403) never fix themselves;
// the default three retries only stretch loading states by ~7 seconds.
// Network and server errors keep the retries.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: unknown } | null)?.status;
        const clientError = typeof status === 'number' && status >= 400 && status < 500;
        return !clientError && failureCount < 3;
      },
    },
  },
});

function Router() {
  return (
    <AppLayout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/rules" component={RulePerformancePage} />
          <Route path="/intel" component={CounterpartyIntelPage} />
          <Route path="/about" component={AboutPage} />
          <Route path="/cases" component={CaseList} />
          <Route path="/register" component={DeclarationIntakePage} />
          <Route path="/register/:id" component={DeclarationReviewPage} />
          <Route path="/cases/:id/disclosure" component={CaseDisclosureWorkbench} />
          <Route path="/cases/:id/network" component={CaseNetwork} />
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
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;