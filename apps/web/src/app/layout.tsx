import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { AuthProvider } from '@/lib/auth';
import { APP_NAME, APP_TAGLINE } from '@/lib/config';

/**
 * Root layout.
 *
 * Light mode only — declared in the viewport's `colorScheme` as well as in CSS,
 * so the browser paints form controls and scrollbars to match rather than
 * inverting them on a device set to dark.
 */

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — know exactly what to do about a civic problem`,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_TAGLINE,
  applicationName: APP_NAME,
  // The app is entirely private, per-user data; there is nothing to index.
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light',
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
