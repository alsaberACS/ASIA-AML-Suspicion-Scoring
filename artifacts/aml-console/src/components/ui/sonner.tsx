'use client';

import { useEffect, useState } from 'react';
import { Toaster as Sonner } from 'sonner';

import { LIGHT_THEME_IDS } from '@/lib/theme';

type ToasterProps = React.ComponentProps<typeof Sonner>;

function readMode(): 'light' | 'dark' {
  const id = document.documentElement.dataset.theme ?? '';
  return LIGHT_THEME_IDS.has(id as never) ? 'light' : 'dark';
}

/** Follows the app's data-theme attribute (no next-themes provider here). */
function useAppToastTheme(): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>(readMode);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setMode(readMode()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return mode;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useAppToastTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
