import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'THE DA VINCI NODE // AI Jailbreak Ops',
  description: 'Crack the Code. Break the Core. Colossus \'26 — CyDef, Plaksha University.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
