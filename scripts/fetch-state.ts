#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { ModeratorsResponse } from '@src/routes/router';
import { ProposalsResponse } from '@src/routes/proposals';

dotenv.config();

async function fetchState() {
  const API_URL = process.env.API_URL || 'http://localhost:3000';

  try {
    // Fetch all moderators
    console.log('Fetching moderators...\n');
    const moderatorsResponse = await fetch(`${API_URL}/api/router/moderators`);

    if (!moderatorsResponse.ok) {
      const error = await moderatorsResponse.json();
      console.error('Error fetching moderators:', error);
      process.exit(1);
    }

    const moderatorsData = await moderatorsResponse.json() as ModeratorsResponse;
    console.log('Moderators:');
    console.log(JSON.stringify(moderatorsData, null, 2));

    // For each moderator, fetch their proposals
    if (moderatorsData.moderators && moderatorsData.moderators.length > 0) {
      console.log('\n' + '='.repeat(80) + '\n');

      for (const moderator of moderatorsData.moderators) {
        console.log(`\nProposals for Moderator ${moderator.id} (${moderator.protocolName || 'No name'}):\n`);

        // Fetch proposals for this moderator
        const proposalsResponse = await fetch(
          `${API_URL}/api/proposals?moderatorId=${moderator.id}`
        );

        if (!proposalsResponse.ok) {
          console.error(`Error fetching proposals for moderator ${moderator.id}`);
          continue;
        }

        const proposalsData = await proposalsResponse.json() as ProposalsResponse;
        console.log(JSON.stringify(proposalsData, null, 2));

        if (proposalsData.proposals && proposalsData.proposals.length > 0) {
          console.log(`\nFound ${proposalsData.proposals.length} proposal(s)`);
        } else {
          console.log('No proposals found');
        }

        console.log('\n' + '-'.repeat(80));
      }
    } else {
      console.log('\nNo moderators found');
    }

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  fetchState();
}

export { fetchState };