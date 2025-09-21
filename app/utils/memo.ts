import { PublicKey, TransactionInstruction } from '@solana/web3.js';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/**
 * Creates a memo instruction for transaction labeling on Solscan
 * @param message - The message to include in the memo
 * @returns Transaction instruction for the memo program
 */
export function createMemoIx(message: string): TransactionInstruction {
  return {
    programId: MEMO_PROGRAM_ID,
    keys: [],
    data: Buffer.from(message)
  };
}

export { MEMO_PROGRAM_ID };