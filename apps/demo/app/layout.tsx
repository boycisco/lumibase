import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'LumiBase Demo — Base Sepolia USDC Payment Verification',
  description: 'LumiBase v0.1 Base Sepolia USDC payment flow demo and Backend-for-Frontend.',
  openGraph: {
    title: 'LumiBase Demo — Base Sepolia USDC Payment Verification',
    description: 'LumiBase v0.1 Base Sepolia USDC payment flow demo and Backend-for-Frontend.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LumiBase Demo — Base Sepolia USDC Payment Verification',
    description: 'LumiBase v0.1 Base Sepolia USDC payment flow demo and Backend-for-Frontend.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${jetbrainsMono.variable}`}>
      <body
        suppressHydrationWarning
        className="min-h-screen bg-slate-50 text-slate-900 antialiased selection:bg-blue-100 selection:text-blue-900"
      >
        {children}
      </body>
    </html>
  );
}
