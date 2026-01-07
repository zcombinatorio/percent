#!/usr/bin/env npx ts-node
/*
 * Manually run finalization flow for a proposal
 * Usage: npx ts-node monitor/scripts/finalize-proposal.ts <proposal_pda>
 */

import { callApi } from '../lib/api';

const proposalPda = process.argv[2];

if (!proposalPda) {
  console.error('Usage: npx ts-node monitor/scripts/finalize-proposal.ts <proposal_pda>');
  process.exit(1);
}

async function runFinalizationFlow() {
  console.log(`\nRunning finalization flow for: ${proposalPda}\n`);

  // Step 1: Finalize proposal
  console.log('Step 1: Finalizing proposal...');
  try {
    const data = await callApi('/dao/finalize-proposal', { proposal_pda: proposalPda }) as {
      winning_option: string;
    };
    console.log(`  ✓ Finalized (winner: ${data.winning_option})`);
  } catch (e) {
    console.error(`  ✗ Finalize failed:`, e);
  }

  // Step 2: Redeem liquidity
  console.log('Step 2: Redeeming liquidity...');
  try {
    const data = await callApi('/dao/redeem-liquidity', { proposal_pda: proposalPda }) as {
      transaction: string;
    };
    console.log(`  ✓ Redeemed (tx: ${data.transaction})`);
  } catch (e) {
    console.error(`  ✗ Redeem failed:`, e);
  }

  // Step 3: Deposit back
  console.log('Step 3: Depositing back...');
  try {
    const data = await callApi('/dao/deposit-back', { proposal_pda: proposalPda }) as {
      skipped?: boolean;
      reason?: string;
      transaction?: string;
    };
    if (data.skipped) {
      console.log(`  ⊘ Skipped (${data.reason})`);
    } else {
      console.log(`  ✓ Deposit-back complete${data.transaction ? ` (tx: ${data.transaction})` : ''}`);
    }
  } catch (e) {
    console.error(`  ✗ Deposit-back failed:`, e);
  }

  console.log('\nDone.\n');
}

runFinalizationFlow().catch(console.error);
