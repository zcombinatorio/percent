'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';

export default function PortfolioPage() {
  const { connected, publicKey } = useWallet();

  if (!connected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <div className="flex items-center gap-3 text-yellow-500 mb-4">
            <AlertCircle className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Wallet Connection Required</h2>
          </div>
          <p className="text-gray-400">
            Please connect your wallet to view your portfolio.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Your Portfolio</h1>
        <p className="text-gray-400">
          Wallet: {publicKey?.toString().slice(0, 4)}...{publicKey?.toString().slice(-4)}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <p className="text-gray-400 text-sm mb-2">Total Value</p>
          <p className="text-2xl font-bold">$1,234.56</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <p className="text-gray-400 text-sm mb-2">Active Positions</p>
          <p className="text-2xl font-bold">5</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <p className="text-gray-400 text-sm mb-2">P&L (24h)</p>
          <p className="text-2xl font-bold text-green-500 flex items-center gap-2">
            +12.3% <TrendingUp className="h-5 w-5" />
          </p>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800">
          <h2 className="text-xl font-semibold">Active Positions</h2>
        </div>
        <div className="p-6">
          <table className="w-full">
            <thead>
              <tr className="text-left text-gray-400 text-sm">
                <th className="pb-4">Proposal</th>
                <th className="pb-4">Position</th>
                <th className="pb-4">Amount</th>
                <th className="pb-4">Current Value</th>
                <th className="pb-4">P&L</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              <tr className="border-t border-gray-800">
                <td className="py-4">Treasury Diversification</td>
                <td className="py-4">
                  <span className="px-2 py-1 bg-green-900/30 text-green-400 rounded text-xs">PASS</span>
                </td>
                <td className="py-4">100 tokens</td>
                <td className="py-4">$234.50</td>
                <td className="py-4 text-green-500">+15.2%</td>
              </tr>
              <tr className="border-t border-gray-800">
                <td className="py-4">Protocol Fee Update</td>
                <td className="py-4">
                  <span className="px-2 py-1 bg-red-900/30 text-red-400 rounded text-xs">FAIL</span>
                </td>
                <td className="py-4">50 tokens</td>
                <td className="py-4">$112.00</td>
                <td className="py-4 text-red-500">-5.8%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}