'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Info, TrendingUp, TrendingDown, Database, Activity, Clock, DollarSign, Layers, Hash, CheckCircle } from 'lucide-react';

interface AnalyticsData {
  id: number;
  description: string;
  status: string;
  createdAt: string;
  finalizedAt?: string;
  proposalStatus: string;
  proposalLength: number;
  baseMint: string;
  quoteMint: string;
  authority: string;
  ammConfig?: {
    initialBaseAmount: string;
    initialQuoteAmount: string;
  };
  vaults: {
    base?: {
      state: string;
      passConditionalMint: string;
      failConditionalMint: string;
      escrow: string;
      passConditionalSupply: string;
      failConditionalSupply: string;
      escrowSupply: string;
    };
    quote?: {
      state: string;
      passConditionalMint: string;
      failConditionalMint: string;
      escrow: string;
      passConditionalSupply: string;
      failConditionalSupply: string;
      escrowSupply: string;
    };
  };
  amms: {
    pass?: {
      state: string;
      baseMint: string;
      quoteMint: string;
      pool?: string;
      price?: number;
      liquidity?: string;
    };
    fail?: {
      state: string;
      baseMint: string;
      quoteMint: string;
      pool?: string;
      price?: number;
      liquidity?: string;
    };
  };
  twap: {
    values?: {
      passTwap: number;
      failTwap: number;
      passAggregation: number;
      failAggregation: number;
    };
    status?: string;
    initialTwapValue: number;
    twapStartDelay: number;
    passThresholdBps: number;
    twapMaxObservationChangePerUpdate: number;
  };
}

export default function AnalyticsDashboard() {
  const params = useParams();
  const proposalId = params.id as string;
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  useEffect(() => {
    fetchAnalytics();
  }, [proposalId]);

  useEffect(() => {
    if (!data) return;
    
    const calculateTimeRemaining = () => {
      const created = new Date(data.createdAt).getTime();
      const endTime = created + data.proposalLength * 1000; // proposalLength is in seconds
      const now = Date.now();
      const remaining = endTime - now;
      
      if (remaining <= 0 || data.status !== 'Pending') {
        setTimeRemaining('Ended');
        return;
      }
      
      const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
      const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
      
      let timeString = '';
      if (days > 0) timeString += `${days}d `;
      if (hours > 0 || days > 0) timeString += `${hours}h `;
      if (minutes > 0 || hours > 0 || days > 0) timeString += `${minutes}m `;
      timeString += `${seconds}s`;
      
      setTimeRemaining(timeString);
    };
    
    calculateTimeRemaining();
    const interval = setInterval(calculateTimeRemaining, 1000);
    
    return () => clearInterval(interval);
  }, [data]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/api/analytics/${proposalId}`, {
        headers: {
          'x-api-key': '06c9d2db9cea4bb1c68ef2bdd5ed6418dd1bf61606ac81bd1ef52fd8c00c7da6'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch analytics: ${response.status}`);
      }
      
      const analyticsData = await response.json();
      setData(analyticsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
    } finally {
      setLoading(false);
    }
  };

  const truncateAddress = (address: string) => {
    if (!address) return 'N/A';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const formatSupply = (supply: string, decimals: number = 6) => {
    // Convert from smallest unit to actual tokens
    const num = parseFloat(supply) / Math.pow(10, decimals);
    if (num === 0) return '0';
    if (num < 1) return num.toFixed(4);
    if (num < 1000) return num.toFixed(2);
    if (num < 1000000) return `${(num / 1000).toFixed(2)}K`;
    if (num < 1000000000) return `${(num / 1000000).toFixed(2)}M`;
    return `${(num / 1000000000).toFixed(2)}B`;
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 font-mono tracking-wider">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400 tracking-wide">Loading analytics...</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 font-mono tracking-wider">
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-6">
          <p className="text-red-400 tracking-wide">{error || 'Failed to load analytics'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 font-mono tracking-wider">
      {/* Title */}
      <h1 className="text-3xl font-bold mb-8 tracking-wide">
        Proposal #{data.id}: {data.description || 'Untitled Proposal'}
      </h1>

      {/* Proposal Overview - Most Important */}
      <div className="bg-gray-800/30 border border-gray-700/30 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 tracking-wide">
          <Info className="h-6 w-6" />
          Proposal Overview
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-2 px-3 text-gray-400">Status</th>
                <th className="text-left py-2 px-3 text-gray-400">Time Remaining</th>
                <th className="text-left py-2 px-3 text-gray-400">Authority</th>
                <th className="text-left py-2 px-3 text-gray-400">Created At</th>
                <th className="text-left py-2 px-3 text-gray-400">{data.finalizedAt ? 'Finalized At' : 'Will Finalize At'}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-2 px-3">
                  <span className={`px-2 py-1 rounded text-base ${
                    data.status === 'Pending' 
                      ? 'bg-green-900/30 text-green-400' 
                      : data.status === 'Passed'
                      ? 'bg-blue-900/30 text-blue-400'
                      : data.status === 'Failed'
                      ? 'bg-red-900/30 text-red-400'
                      : 'bg-gray-800 text-gray-400'
                  }`}>
                    {data.status}
                  </span>
                </td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span className="text-lg">{timeRemaining}</span>
                  </div>
                </td>
                <td className="py-2 px-3 text-lg">{truncateAddress(data.authority)}</td>
                <td className="py-2 px-3 text-lg">{new Date(data.createdAt).toLocaleString()}</td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2">
                    {data.finalizedAt && <CheckCircle className="h-4 w-4 text-green-400" />}
                    <span className="text-lg">
                      {data.finalizedAt 
                        ? new Date(data.finalizedAt).toLocaleString()
                        : new Date(new Date(data.createdAt).getTime() + data.proposalLength * 1000).toLocaleString()
                      }
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* TWAP Oracle - Second Most Important */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* TWAP Oracle Box */}
        <div className="bg-gray-800/30 border border-gray-700/30 rounded-lg p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity className="h-6 w-6" />
              <h3 className="text-lg font-semibold tracking-wide">TWAP Oracle</h3>
            </div>
              {data.twap.status && (
                <span className={`px-2 py-1 rounded text-sm ${
                  data.twap.status === 'Passing' 
                    ? 'bg-green-900/30 text-green-400'
                    : data.twap.status === 'Failing'
                    ? 'bg-red-900/30 text-red-400'
                    : 'bg-gray-800 text-gray-400'
                }`}>
                  {data.twap.status}
                </span>
              )}
            </div>
            {data.twap.values && (
              <div className="mb-4">
                <table className="w-full">
                  <tbody>
                    <tr className="border-b border-gray-700">
                      <td className="py-3 px-3 text-gray-400">Difference</td>
                      <td className="py-3 px-3 text-lg text-right font-semibold">
                        {((data.twap.values.passTwap - data.twap.values.failTwap) * 100).toFixed(2)}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full border border-gray-700/50">
                <thead>
                  <tr className="border-b border-gray-700/50 bg-gray-900/30">
                    <th className="text-left py-3 px-4 text-gray-400 font-medium border-r border-gray-700/50"></th>
                    <th className="text-center py-3 px-4 text-green-400 font-semibold border-r border-gray-700/50">Pass</th>
                    <th className="text-center py-3 px-4 text-red-400 font-semibold">Fail</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-700/50">
                    <td className="py-3 px-4 text-gray-400 font-medium border-r border-gray-700/50 bg-gray-900/20">TWAP</td>
                    <td className="py-3 px-4 text-lg text-center font-semibold border-r border-gray-700/50">
                      {data.twap.values?.passTwap.toFixed(4) || 'N/A'}
                    </td>
                    <td className="py-3 px-4 text-lg text-center font-semibold">
                      {data.twap.values?.failTwap.toFixed(4) || 'N/A'}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 text-gray-400 font-medium border-r border-gray-700/50 bg-gray-900/20">Aggregator</td>
                    <td className="py-3 px-4 text-lg text-center border-r border-gray-700/50">
                      {data.twap.values?.passAggregation ? 
                        (data.twap.values.passAggregation > 999999 ? 
                          `${(data.twap.values.passAggregation / 1000000).toFixed(1)}M` : 
                          data.twap.values.passAggregation.toLocaleString()) 
                        : 'N/A'}
                    </td>
                    <td className="py-3 px-4 text-lg text-center">
                      {data.twap.values?.failAggregation ? 
                        (data.twap.values.failAggregation > 999999 ? 
                          `${(data.twap.values.failAggregation / 1000000).toFixed(1)}M` : 
                          data.twap.values.failAggregation.toLocaleString()) 
                        : 'N/A'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        
        {/* TWAP Configuration Box */}
        <div className="bg-gray-800/30 border border-gray-700/30 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 tracking-wide">TWAP Configuration</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <tbody>
                  <tr className="border-b border-gray-700">
                    <td className="py-3 px-3 text-gray-400">Pass Threshold</td>
                    <td className="py-3 px-3 text-lg text-right">
                      {(data.twap.passThresholdBps / 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr className="border-b border-gray-700">
                    <td className="py-3 px-3 text-gray-400">Initial Value</td>
                    <td className="py-3 px-3 text-lg text-right">
                      {data.twap.initialTwapValue}
                    </td>
                  </tr>
                  <tr className="border-b border-gray-700">
                    <td className="py-3 px-3 text-gray-400">Max Change</td>
                    <td className="py-3 px-3 text-lg text-right">
                      {data.twap.twapMaxObservationChangePerUpdate || 'None'}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 text-gray-400">Start Delay</td>
                    <td className="py-3 px-3 text-lg text-right">
                      {data.twap.twapStartDelay}ms
                    </td>
                  </tr>
                </tbody>
              </table>
          </div>
        </div>
      </div>

      {/* AMM Prices - Third Most Important */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-gradient-to-br from-emerald-900/15 to-green-900/15 border border-green-800/40 rounded-lg p-6 relative">
          {data.amms.pass && (
            <span className={`absolute top-4 right-4 px-2 py-1 rounded text-sm ${
              data.amms.pass.state === 'Trading' 
                ? 'bg-green-900/30 text-green-400'
                : data.amms.pass.state === 'Paused'
                ? 'bg-yellow-900/30 text-yellow-400'
                : data.amms.pass.state === 'Finalized'
                ? 'bg-blue-900/30 text-blue-400'
                : 'bg-gray-800 text-gray-400'
            }`}>
              {data.amms.pass.state}
            </span>
          )}
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 tracking-wide">
            <TrendingUp className="h-6 w-6" />
            Pass Market AMM
          </h2>
          {data.amms.pass ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-left py-2 px-3 text-gray-400 font-semibold">Price</span>
                {data.amms.pass.price ? (
                  <span className="text-xl text-green-500">
                    ${data.amms.pass.price.toFixed(4)}
                  </span>
                ) : (
                  <span className="text-2xl text-gray-600">—</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-left py-2 px-3 text-gray-400 font-semibold">Liquidity</span>
                {data.amms.pass.liquidity ? (
                  <span className="text-lg">{formatSupply(data.amms.pass.liquidity, 0)}</span>
                ) : (
                  <span className="text-lg text-gray-600">—</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-left py-2 px-3 text-gray-400 font-semibold">Pool</span>
                <span className="text-base">{truncateAddress(data.amms.pass.pool || '')}</span>
              </div>
            </div>
          ) : (
            <p className="text-base text-gray-400">Not initialized</p>
          )}
        </div>

        <div className="bg-gradient-to-br from-red-900/15 to-rose-900/15 border border-red-800/40 rounded-lg p-6 relative">
          {data.amms.fail && (
            <span className={`absolute top-4 right-4 px-2 py-1 rounded text-sm ${
              data.amms.fail.state === 'Trading' 
                ? 'bg-green-900/30 text-green-400'
                : data.amms.fail.state === 'Paused'
                ? 'bg-yellow-900/30 text-yellow-400'
                : data.amms.fail.state === 'Finalized'
                ? 'bg-blue-900/30 text-blue-400'
                : 'bg-gray-800 text-gray-400'
            }`}>
              {data.amms.fail.state}
            </span>
          )}
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 tracking-wide">
            <TrendingDown className="h-6 w-6" />
            Fail Market AMM
          </h2>
          {data.amms.fail ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-left py-2 px-3 text-gray-400 font-semibold">Price</span>
                {data.amms.fail.price ? (
                  <span className="text-xl text-red-500">
                    ${data.amms.fail.price.toFixed(4)}
                  </span>
                ) : (
                  <span className="text-2xl text-gray-600">—</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-left py-2 px-3 text-gray-400 font-semibold">Liquidity</span>
                {data.amms.fail.liquidity ? (
                  <span className="text-lg">{formatSupply(data.amms.fail.liquidity, 0)}</span>
                ) : (
                  <span className="text-lg text-gray-600">—</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-left py-2 px-3 text-gray-400 font-semibold">Pool</span>
                <span className="text-base">{truncateAddress(data.amms.fail.pool || '')}</span>
              </div>
            </div>
          ) : (
            <p className="text-base text-gray-400">Not initialized</p>
          )}
        </div>
      </div>

      {/* Vault Supplies - Fourth */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-gray-800/30 border border-gray-700/30 rounded-lg p-6 relative">
          {data.vaults.base && (
            <span className={`absolute top-4 right-4 px-2 py-1 rounded text-sm ${
              data.vaults.base.state === 'Active' 
                ? 'bg-green-900/30 text-green-400'
                : data.vaults.base.state === 'Finalized'
                ? 'bg-blue-900/30 text-blue-400'
                : data.vaults.base.state === 'Inactive'
                ? 'bg-gray-800 text-gray-400'
                : 'bg-gray-800 text-gray-400'
            }`}>
              {data.vaults.base.state}
            </span>
          )}
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 tracking-wide">
            <Database className="h-6 w-6" />
            Base Vault
          </h2>
          {data.vaults.base ? (
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-left py-2 px-3 text-gray-400 font-semibold">Pass Supply</span>
                <span className="text-lg text-green-400">
                  {formatSupply(data.vaults.base.passConditionalSupply, 6)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-left py-2 px-3 text-gray-400 font-semibold">Fail Supply</span>
                <span className="text-lg text-red-400">
                  {formatSupply(data.vaults.base.failConditionalSupply, 6)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-left py-2 px-3 text-gray-400 font-semibold">Escrow Supply</span>
                <span className="text-lg">
                  {formatSupply(data.vaults.base.escrowSupply, 6)}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-base text-gray-400">Not initialized</p>
          )}
        </div>

        <div className="bg-gray-800/30 border border-gray-700/30 rounded-lg p-6 relative">
          {data.vaults.quote && (
            <span className={`absolute top-4 right-4 px-2 py-1 rounded text-sm ${
              data.vaults.quote.state === 'Active' 
                ? 'bg-green-900/30 text-green-400'
                : data.vaults.quote.state === 'Finalized'
                ? 'bg-blue-900/30 text-blue-400'
                : data.vaults.quote.state === 'Inactive'
                ? 'bg-gray-800 text-gray-400'
                : 'bg-gray-800 text-gray-400'
            }`}>
              {data.vaults.quote.state}
            </span>
          )}
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 tracking-wide">
            <Database className="h-6 w-6" />
            Quote Vault
          </h2>
          {data.vaults.quote ? (
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-left py-2 px-3 text-gray-400 font-semibold">Pass Supply</span>
                <span className="text-lg text-green-400">
                  {formatSupply(data.vaults.quote.passConditionalSupply, 9)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-left py-2 px-3 text-gray-400 font-semibold">Fail Supply</span>
                <span className="text-lg text-red-400">
                  {formatSupply(data.vaults.quote.failConditionalSupply, 9)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-left py-2 px-3 text-gray-400 font-semibold">Escrow Supply</span>
                <span className="text-lg">
                  {formatSupply(data.vaults.quote.escrowSupply, 9)}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-base text-gray-400">Not initialized</p>
          )}
        </div>
      </div>

      {/* Token Configuration - Least Important */}
      <div className="bg-gray-800/30 border border-gray-700/30 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 tracking-wide">
          <Layers className="h-6 w-6" />
          Token Configuration
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-left py-2 px-3 text-gray-400 font-semibold">Base Mint</p>
            <p className="py-2 px-3 text-lg break-all">{data.baseMint}</p>
          </div>
          <div>
            <p className="text-left py-2 px-3 text-gray-400 font-semibold">Quote Mint</p>
            <p className="py-2 px-3 text-lg break-all">{data.quoteMint}</p>
          </div>
        </div>
        {data.ammConfig && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <p className="text-left py-2 px-3 text-gray-400 font-semibold">Initial Base Amount</p>
              <p className="py-2 px-3 text-lg">{formatSupply(data.ammConfig.initialBaseAmount, 6)}</p>
            </div>
            <div>
              <p className="text-left py-2 px-3 text-gray-400 font-semibold">Initial Quote Amount</p>
              <p className="py-2 px-3 text-lg">{formatSupply(data.ammConfig.initialQuoteAmount, 9)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}