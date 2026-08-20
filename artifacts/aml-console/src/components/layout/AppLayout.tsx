import { Link, useLocation } from 'wouter';
import {
  ShieldAlert,
  LayoutDashboard,
  FolderSearch,
  Settings,
  Bell,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ReactNode } from 'react';

export default function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/cases', label: 'Case Registry', icon: FolderSearch },
  ];

  return (
    <div className="flex h-screen w-full bg-background cyber-grid text-foreground overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col z-10 shadow-xl relative">
        <div className="h-16 flex items-center px-6 border-b border-border bg-background/50">
          <img
            src={import.meta.env.BASE_URL + 'brand/asia-logo-white.png'}
            alt="ASIA Data-Science"
            className="h-7 w-auto object-contain"
          />
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          <div className="px-3 mb-2 text-xs font-mono text-muted-foreground uppercase tracking-widest">
            Modules
          </div>
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-sm transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <item.icon className={`h-4 w-4 ${isActive ? 'text-primary' : 'opacity-70'}`} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border bg-background/50">
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 rounded-sm bg-primary/20 border border-primary/50">
              <AvatarFallback className="bg-transparent text-primary text-xs font-mono">
                OA
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-medium leading-none">O. Analyst</span>
              <span className="text-xs text-muted-foreground font-mono mt-1">Level 3</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 z-0">
        {/* Top Navbar */}
        <header className="h-16 border-b border-border bg-card/80 backdrop-blur flex items-center justify-between px-6 z-20">
          <div className="flex items-center w-full max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search subjects, cases, or transactions..."
                className="w-full bg-background border-border pl-9 rounded-sm focus-visible:ring-primary h-9 font-mono text-sm"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="text-muted-foreground rounded-sm">
              <Bell className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-muted-foreground rounded-sm">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-auto relative">
          <div className="absolute inset-0 pointer-events-none opacity-[0.02] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNmZmYiLz48cmVjdCB3aWR0aD0iMiIgaGVpZ2h0PSIyIiBmaWxsPSIjMDAwIi8+PC9zdmc+')] mix-blend-overlay"></div>
          {children}
        </main>
        
        {/* Footer */}
        <footer className="h-8 border-t border-border bg-card/90 flex items-center px-6 justify-between text-[10px] text-muted-foreground font-mono uppercase tracking-wider z-20">
          <div>ASIA Consulting and Private Training — ASIA DATA-SCIENCE</div>
          <div className="hidden lg:flex items-center gap-4">
            <span>Shayma Tower, Fl 10, Kuwait City</span>
            <span>+965 2227 1724</span>
            <span>info@acs-kw.com</span>
          </div>
        </footer>
      </div>
    </div>
  );
}