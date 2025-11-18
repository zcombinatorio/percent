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

import dotenv from 'dotenv';

dotenv.config();

// Global configuration
const MODERATOR_ID = 1; // Change this to target different moderators

async function executeProposal() {
  const API_URL = process.env.API_URL || 'http://localhost:3001';
  
  const proposalId = process.argv[2];
  
  if (!proposalId) {
    console.error('Usage: npm run execute-proposal <proposal-id>');
    process.exit(1);
  }
  
  const id = parseInt(proposalId);
  if (isNaN(id)) {
    console.error('Invalid proposal ID. Must be a number.');
    process.exit(1);
  }
  
  try {
    const response = await fetch(`${API_URL}/api/proposals/${id}/execute?moderatorId=${MODERATOR_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error(JSON.stringify(error, null, 2));
      process.exit(1);
    }
    
    const result = await response.json();
    console.log(JSON.stringify(result, null, 2));
    
  } catch (error: any) {
    console.error(error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  executeProposal();
}

export { executeProposal };