#!/usr/bin/env ts-node

import dotenv from 'dotenv';

dotenv.config();

async function executeProposal() {
  const API_URL = process.env.API_URL || 'http://localhost:3000';
  const API_KEY = process.env.API_KEY;
  
  if (!API_KEY) {
    console.error('API_KEY environment variable is required');
    process.exit(1);
  }
  
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
    const response = await fetch(`${API_URL}/api/proposals/${id}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': API_KEY
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