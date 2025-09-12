'use client';

import { TrendingUp } from 'lucide-react';
import { usePrivyWallet } from '@/hooks/usePrivyWallet';

export default function Navbar() {
  const { authenticated, walletAddress, login, logout } = usePrivyWallet();

  return (
    <nav className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-2">
            <TrendingUp className="h-8 w-8 text-[#4CBBF4]" />
            <span className="text-white text-xl font-bold">Prediction Market</span>
          </div>
          
          {authenticated ? (
            <div className="flex items-center gap-4">
              <span className="text-gray-400 text-sm">
                {walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Loading...'}
              </span>
              <button
                onClick={logout}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 rounded text-white font-medium transition-colors"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={login}
              className="px-4 py-2 bg-sky-500 hover:bg-sky-600 rounded text-white font-medium transition-colors"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}