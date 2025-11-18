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

dotenv.config();

// Global configuration
const MODERATOR_ID = 1; // Change this to target different moderators

async function finalizeProposal(proposalId?: number) {
  const API_URL = process.env.API_URL || 'http://localhost:3000';
  
  // Get proposal ID from command line argument or environment variable
  const id = proposalId ?? parseInt(process.argv[2] || '');
  
  if (isNaN(id) || id < 0) {
    console.error('Valid proposal ID is required');
    console.error('Usage: ts-node scripts/finalize-proposal.ts <proposal-id>');
    process.exit(1);
  }
  
  try {
    const response = await fetch(`${API_URL}/api/proposals/${id}/finalize?moderatorId=${MODERATOR_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error(JSON.stringify(error, null, 2));
      process.exit(1);
    }
    
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
    
  } catch (error: any) {
    console.error(error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  finalizeProposal();
}

export { finalizeProposal };