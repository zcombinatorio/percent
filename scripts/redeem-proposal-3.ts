import { PublicKey, Keypair } from '@solana/web3.js';
import { ModeratorService } from '../src/services/moderator.service';
import { ExecutionService } from '../app/services/execution.service';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Script to redeem winning tokens from Proposal 2
 */

async function main() {
  console.log('🔄 Starting redemption process for Proposal 2...\n');

  // Initialize services
  const moderator = await ModeratorService.getInstance();

  // Get proposal 2
  const proposal = await moderator.getProposal(2);
  if (!proposal) {
    throw new Error('Proposal 2 not found');
  }

  console.log(`📊 Proposal 2 Status: ${proposal.status}`);

  // Determine winning side
  const winningSide = proposal.status === 'Passed' ? 'PASS' : proposal.status === 'Failed' ? 'FAIL' : null;
  if (!winningSide) {
    throw new Error(`Proposal 2 is not finalized yet (status: ${proposal.status})`);
  }

  console.log(`🎯 Winning side: ${winningSide}\n`);

  // Load authority keypair
  const keypairPath = process.env.SOLANA_KEYPAIR_PATH || './wallet.json';
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(new Uint8Array(keypairData));

  console.log(`🔑 Authority: ${authority.publicKey.toBase58()}\n`);

  // Check balances
  const baseVault = proposal.__baseVault;
  const quoteVault = proposal.__quoteVault;

  if (!baseVault || !quoteVault) {
    throw new Error('Vaults not initialized on proposal');
  }

  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://bernie-zo3q7f-fast-mainnet.helius-rpc.com';
  const executionService = new ExecutionService({
    rpcEndpoint: rpcUrl,
    commitment: 'confirmed'
  });
  const connection = executionService.connection;

  // Get authority's winning token balances
  const { getAssociatedTokenAddress, getAccount } = await import('@solana/spl-token');

  const baseWinningMint = winningSide === 'PASS' ? baseVault.passConditionalMint : baseVault.failConditionalMint;
  const quoteWinningMint = winningSide === 'PASS' ? quoteVault.passConditionalMint : quoteVault.failConditionalMint;

  const authorityBaseWinningAta = await getAssociatedTokenAddress(
    baseWinningMint,
    authority.publicKey
  );
  const authorityQuoteWinningAta = await getAssociatedTokenAddress(
    quoteWinningMint,
    authority.publicKey
  );

  let baseWinningBalance = 0n;
  let quoteWinningBalance = 0n;

  try {
    const baseWinningAccount = await getAccount(connection, authorityBaseWinningAta);
    baseWinningBalance = baseWinningAccount.amount;
    console.log(`💰 Base ${winningSide} tokens: ${Number(baseWinningBalance) / 1e6} ZC`);
  } catch (e) {
    console.log(`💰 Base ${winningSide} tokens: 0 ZC (no account)`);
  }

  try {
    const quoteWinningAccount = await getAccount(connection, authorityQuoteWinningAta);
    quoteWinningBalance = quoteWinningAccount.amount;
    console.log(`💰 Quote ${winningSide} tokens: ${Number(quoteWinningBalance) / 1e9} SOL\n`);
  } catch (e) {
    console.log(`💰 Quote ${winningSide} tokens: 0 SOL (no account)\n`);
  }

  if (baseWinningBalance === 0n && quoteWinningBalance === 0n) {
    console.log(`❌ No ${winningSide} tokens to redeem for authority wallet`);
    return;
  }

  // Redeem base vault winning tokens
  if (baseWinningBalance > 0n) {
    console.log(`🔄 Redeeming ${Number(baseWinningBalance) / 1e6} base ${winningSide} tokens...`);
    const baseRedeemTx = await baseVault.buildRedeemWinningTokensTx(authority.publicKey);
    baseRedeemTx.partialSign(authority);
    const baseTxHash = await baseVault.executeRedeemWinningTokensTx(baseRedeemTx);
    console.log(`✅ Base redemption: ${baseTxHash}`);
    console.log(`   https://solscan.io/tx/${baseTxHash}\n`);
  }

  // Redeem quote vault winning tokens
  if (quoteWinningBalance > 0n) {
    console.log(`🔄 Redeeming ${Number(quoteWinningBalance) / 1e9} quote ${winningSide} tokens...`);
    const quoteRedeemTx = await quoteVault.buildRedeemWinningTokensTx(authority.publicKey);
    quoteRedeemTx.partialSign(authority);
    const quoteTxHash = await quoteVault.executeRedeemWinningTokensTx(quoteRedeemTx);
    console.log(`✅ Quote redemption: ${quoteTxHash}`);
    console.log(`   https://solscan.io/tx/${quoteTxHash}\n`);
  }

  console.log('🎉 Redemption complete!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
