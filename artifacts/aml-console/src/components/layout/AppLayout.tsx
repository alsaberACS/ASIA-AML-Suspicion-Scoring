import { Link, useLocation } from 'wouter';
import {
  ShieldAlert,
  LayoutDashboard,
  FolderSearch,
  Settings,
  Bell,
  Search,
  Check,
  LockKeyhole,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ReactNode, useState } from 'react';
import { THEMES, applyTheme, getSavedTheme, type ThemeId } from '@/lib/theme';
import { lockConsole } from '@/lib/access';

export default function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [theme, setTheme] = useState<ThemeId>(getSavedTheme);

  const handleThemeChange = (id: ThemeId) => {
    applyTheme(id);
    setTheme(id);
  };

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
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground rounded-sm"
                  aria-label="Settings"
                  data-testid="button-settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-3">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                  Settings
                </div>
                <div className="text-sm font-medium mb-3">Color theme</div>
                <div className="space-y-1.5">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleThemeChange(t.id)}
                      aria-pressed={theme === t.id}
                      data-testid={`theme-${t.id}`}
                      className={`w-full flex items-center gap-3 p-2 rounded-sm border text-left transition-colors ${
                        theme === t.id
                          ? 'border-primary/50 bg-primary/10'
                          : 'border-transparent hover:border-border hover:bg-muted/40'
                      }`}
                    >
                      <span className="flex shrink-0 -space-x-1.5">
                        {t.swatches.map((c, i) => (
                          <span
                            key={i}
                            className="h-4 w-4 rounded-full border border-white/15"
                            style={{ backgroundColor: c, zIndex: 3 - i }}
                          />
                        ))}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-medium">{t.label}</span>
                        <span className="block text-[10px] text-muted-foreground truncate">
                          {t.tagline}
                        </span>
                      </span>
                      {theme === t.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
                  Applies instantly and is remembered on this device.
                </p>
                <div className="border-t border-border mt-3 pt-2">
                  <button
                    type="button"
                    onClick={lockConsole}
                    data-testid="button-lock-console"
                    className="w-full flex items-center gap-2 p-2 rounded-sm text-left font-mono text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LockKeyhole className="h-3.5 w-3.5" />
                    Lock console
                  </button>
                </div>
              </PopoverContent>
            </Popover>
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