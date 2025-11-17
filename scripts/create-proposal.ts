#!/usr/bin/env ts-node

import { CreateProposalRequest } from '@src/routes/proposals';
import * as dotenv from 'dotenv';

dotenv.config();

// Global configuration
const MODERATOR_ID = 1; // Change this to target different moderators

async function createProposal() {
  const API_URL = process.env.API_URL || 'http://localhost:3001';
  const API_KEY = process.env.API_KEY;
  const CREATOR_WALLET = process.env.CREATOR_WALLET;

  if (!API_KEY) {
    console.error('API_KEY environment variable is required');
    process.exit(1);
  }

  if (!CREATOR_WALLET) {
    console.error('CREATOR_WALLET environment variable is required');
    console.error('This wallet must be whitelisted in src/config/whitelist.ts');
    process.exit(1);
  }

  // New simplified request - DAMM withdrawal handles AMM initialization automatically
  const request: CreateProposalRequest = {
    title: 'Test Proposal',
    description: 'Should ZC execute on PR #42? https://github.com/zcombinatorio/zcombinator/pull/42',
    proposalLength: 86400, // 24 hours in seconds
    creatorWallet: CREATOR_WALLET, // Must be whitelisted
  };

  console.log('Creating proposal with:', {
    title: request.title,
    proposalLength: request.proposalLength,
    creatorWallet: request.creatorWallet
  });

  try {
    const response = await fetch(`${API_URL}/api/proposals?moderatorId=${MODERATOR_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': API_KEY
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to create proposal:', JSON.stringify(error, null, 2));
      process.exit(1);
    }

    const data = await response.json();
    console.log('Proposal created successfully:', JSON.stringify(data, null, 2));

  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  createProposal();
}

export { createProposal };
