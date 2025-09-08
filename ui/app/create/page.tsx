'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { AlertCircle } from 'lucide-react';

export default function CreateProposalPage() {
  const router = useRouter();
  const { connected } = useWallet();
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    votingPeriodDays: 7,
    passThreshold: 60,
    executionInstruction: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) {
      alert('Please connect your wallet first');
      return;
    }

    console.log('Creating proposal:', formData);
    router.push('/');
  };

  if (!connected) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <div className="flex items-center gap-3 text-yellow-500 mb-4">
            <AlertCircle className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Wallet Connection Required</h2>
          </div>
          <p className="text-gray-400">
            Please connect your wallet to create a governance proposal.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Create New Proposal</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="title" className="block text-sm font-medium mb-2">
            Proposal Title
          </label>
          <input
            type="text"
            id="title"
            required
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg focus:outline-none focus:border-blue-500"
            placeholder="Enter proposal title..."
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium mb-2">
            Description
          </label>
          <textarea
            id="description"
            required
            rows={4}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg focus:outline-none focus:border-blue-500"
            placeholder="Describe what this proposal will do..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="votingPeriod" className="block text-sm font-medium mb-2">
              Voting Period (days)
            </label>
            <input
              type="number"
              id="votingPeriod"
              required
              min="1"
              max="30"
              value={formData.votingPeriodDays}
              onChange={(e) => setFormData({ ...formData, votingPeriodDays: parseInt(e.target.value) })}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label htmlFor="passThreshold" className="block text-sm font-medium mb-2">
              Pass Threshold (%)
            </label>
            <input
              type="number"
              id="passThreshold"
              required
              min="1"
              max="100"
              value={formData.passThreshold}
              onChange={(e) => setFormData({ ...formData, passThreshold: parseInt(e.target.value) })}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label htmlFor="instruction" className="block text-sm font-medium mb-2">
            Execution Instruction (Base64)
          </label>
          <textarea
            id="instruction"
            rows={3}
            value={formData.executionInstruction}
            onChange={(e) => setFormData({ ...formData, executionInstruction: e.target.value })}
            className="w-full px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg focus:outline-none focus:border-blue-500 font-mono text-sm"
            placeholder="Paste base64 encoded Solana instruction..."
          />
          <p className="text-xs text-gray-500 mt-1">
            Optional: Solana instruction to execute if proposal passes
          </p>
        </div>

        <div className="flex gap-4">
          <button
            type="submit"
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition"
          >
            Create Proposal
          </button>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-medium py-3 px-6 rounded-lg transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}