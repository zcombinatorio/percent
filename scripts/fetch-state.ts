#!/usr/bin/env ts-node
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