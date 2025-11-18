/*
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This file is part of Z Combinator.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono, Roboto_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import PrivyProviderWrapper from "@/providers/PrivyProvider";
import ErrorBoundary from "@/components/ErrorBoundary";
import FeedbackWidget from "@/components/FeedbackWidget";
import { Toaster } from "react-hot-toast";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-mono",
});

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-roboto-mono",
});

const rinter = localFont({
  src: "../public/fonts/Rinter.ttf",
  variable: "--font-rinter",
});

const supplyMono = localFont({
  src: [
    {
      path: "../public/fonts/PPSupplyMono-Regular.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/PPSupplyMono-Ultralight.otf",
      weight: "200",
      style: "normal",
    },
  ],
  variable: "--font-supply-mono",
});

const supplySans = localFont({
  src: [
    {
      path: "../public/fonts/PPSupplySans-Regular.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/PPSupplySans-Ultralight.otf",
      weight: "200",
      style: "normal",
    },
  ],
  variable: "--font-supply-sans",
});

export const metadata: Metadata = {
  title: "Z Combinator",
  description: "Trade decision markets",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script src="/charting_library/charting_library/charting_library.standalone.js" async></script>
      </head>
      <body
        className={`${inter.variable} ${ibmPlexMono.variable} ${robotoMono.variable} ${rinter.variable} ${supplyMono.variable} ${supplySans.variable} font-sans antialiased bg-[#0a0a0a] text-white`}
      >
        <ErrorBoundary>
          <PrivyProviderWrapper>
            {children}
            <FeedbackWidget />
            <Toaster
              position="bottom-right"
              toastOptions={{
                style: {
                  background: '#272727',
                  color: '#fff',
                  borderRadius: '8px',
                  border: '1px solid #404040',
                },
                success: {
                  iconTheme: {
                    primary: '#10b981',
                    secondary: '#fff',
                  },
                },
                error: {
                  iconTheme: {
                    primary: '#ef4444',
                    secondary: '#fff',
                  },
                },
              }}
            />
          </PrivyProviderWrapper>
        </ErrorBoundary>
      </body>
    </html>
  );
}
