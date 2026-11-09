import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'AutoApply', template: '%s · AutoApply' },
  description: 'AI-powered job discovery, matching and application tracking',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Browser extensions inject attributes into <html>/<body> before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
