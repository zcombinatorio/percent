#!/usr/bin/env npx tsx
/*
 * Test script for futarchy API integration
 * Run with: npx tsx scripts/test-futarchy-api.ts
 */

const ZCOMBINATOR_API_URL = process.env.NEXT_PUBLIC_ZCOMBINATOR_API_URL || 'http://localhost:3333';

interface ZcombinatorDAO {
  id: number;
  dao_pda: string;
  dao_name: string;
  moderator_pda: string;
  pool_address: string;
  token_mint: string;
  verified?: boolean;
  icon?: string;
  stats: {
    proposerCount: number;
    childDaoCount: number;
    proposalCount: number;
  };
}

interface Proposal {
  id: number;
  proposalPda: string;
  title: string;
  description: string;
  options: string[];
  status: 'Pending' | 'Passed' | 'Failed';
  createdAt: number;
  finalizedAt: number | null;
  metadataCid: string | null;
}

async function testListDaos() {
  console.log('\n=== Testing GET /dao (list DAOs) ===');
  const response = await fetch(`${ZCOMBINATOR_API_URL}/dao`);
  if (!response.ok) {
    console.error(`Failed: ${response.status} ${response.statusText}`);
    return null;
  }
  const data = await response.json() as { daos: ZcombinatorDAO[] };
  console.log(`Found ${data.daos.length} DAOs:`);
  data.daos.forEach(dao => {
    console.log(`  - ${dao.dao_name} (verified: ${dao.verified ?? 'unknown'}, proposals: ${dao.stats.proposalCount})`);
  });
  return data.daos;
}

async function testGetDaoByName(name: string) {
  console.log(`\n=== Testing GET /dao (find by name: ${name}) ===`);
  const response = await fetch(`${ZCOMBINATOR_API_URL}/dao`);
  if (!response.ok) {
    console.error(`Failed: ${response.status} ${response.statusText}`);
    return null;
  }
  const data = await response.json() as { daos: ZcombinatorDAO[] };
  const dao = data.daos.find(d => d.dao_name.toLowerCase() === name.toLowerCase());
  if (dao) {
    console.log(`Found DAO: ${dao.dao_name}`);
    console.log(`  PDA: ${dao.dao_pda}`);
    console.log(`  Pool: ${dao.pool_address}`);
    console.log(`  Token: ${dao.token_mint}`);
    console.log(`  Verified: ${dao.verified}`);
    console.log(`  Stats: ${JSON.stringify(dao.stats)}`);
  } else {
    console.log(`DAO not found: ${name}`);
  }
  return dao;
}

async function testGetProposals(daoPda: string, daoName: string) {
  console.log(`\n=== Testing GET /dao/${daoPda}/proposals ===`);
  const response = await fetch(`${ZCOMBINATOR_API_URL}/dao/${daoPda}/proposals`);
  if (!response.ok) {
    console.error(`Failed: ${response.status} ${response.statusText}`);
    const text = await response.text();
    console.error(`Response: ${text}`);
    return null;
  }
  const data = await response.json() as { proposals: Proposal[] };
  console.log(`Found ${data.proposals.length} proposals for ${daoName}:`);
  data.proposals.forEach(p => {
    console.log(`  - #${p.id}: ${p.title} (${p.status})`);
    console.log(`    PDA: ${p.proposalPda}`);
    console.log(`    Created: ${new Date(p.createdAt).toISOString()}`);
  });
  return data.proposals;
}

async function main() {
  console.log(`Using zcombinator API: ${ZCOMBINATOR_API_URL}`);

  // Test listing all DAOs
  const daos = await testListDaos();
  if (!daos || daos.length === 0) {
    console.error('\nNo DAOs found. Make sure zcombinator API is running.');
    process.exit(1);
  }

  // Test finding a specific DAO
  const testDaoName = process.argv[2] || daos[0]?.dao_name || 'childtestdao';
  const dao = await testGetDaoByName(testDaoName);

  if (dao) {
    // Test fetching proposals
    await testGetProposals(dao.dao_pda, dao.dao_name);
  }

  console.log('\n=== Tests Complete ===');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
