'use client';

import { useState, useMemo, useCallback } from 'react';
import { usePrivyWallet } from '@/hooks/usePrivyWallet';
import { useTransactionSigner } from '@/hooks/useTransactionSigner';
import { PublicKey } from '@solana/web3.js';
import toast from 'react-hot-toast';
import { formatNumber } from '@/lib/formatters';
import { deposit, withdraw, VaultType, type UserBalancesResponse } from '@/lib/programs/vault';

const SOL_DECIMALS = 9;
const ZC_DECIMALS = 6;
const SOL_GAS_RESERVE = 0.02; // Reserve for transaction fees

interface DepositCardProps {
  proposalId: number;
  vaultPDA: string;
  solBalance: number | null;
  baseTokenBalance: number | null;
  userBalances: UserBalancesResponse | null;
  onDepositSuccess: () => void;
  tokenSymbol?: string;
}

export function DepositCard({ proposalId, vaultPDA, solBalance, baseTokenBalance, userBalances, onDepositSuccess, tokenSymbol = 'ZC' }: DepositCardProps) {
  const { authenticated, walletAddress, login } = usePrivyWallet();
  const { signTransaction } = useTransactionSigner();
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState<'sol' | 'zc'>('sol');
  const [isDepositing, setIsDepositing] = useState(false);

  // Calculate max balance
  const maxBalance = useMemo(() => {
    if (mode === 'deposit') {
      const balance = selectedToken === 'sol' ? (solBalance || 0) : (baseTokenBalance || 0);
      // Reserve gas for SOL deposits
      return selectedToken === 'sol' ? Math.max(0, balance - SOL_GAS_RESERVE) : balance;
    } else {
      // Withdraw mode: can only merge min of ALL conditional token balances
      if (!userBalances) return 0;

      const decimals = selectedToken === 'sol' ? SOL_DECIMALS : ZC_DECIMALS;
      const vault = selectedToken === 'sol' ? userBalances.quote : userBalances.base;

      // Find minimum across all conditional balances (supports 2-4 coins)
      const balances = vault.conditionalBalances.map(b => parseFloat(b));
      const minBalance = Math.min(...balances);

      // Convert from smallest units to decimal
      return minBalance / Math.pow(10, decimals);
    }
  }, [mode, selectedToken, solBalance, baseTokenBalance, userBalances]);

  // Validate balance
  const balanceError = useMemo(() => {
    if (!amount) return null;
    const inputAmount = parseFloat(amount);
    if (isNaN(inputAmount) || inputAmount <= 0) return null;

    if (inputAmount > maxBalance) {
      const decimals = selectedToken === 'sol' ? 3 : 0;
      return `Insufficient balance. Max: ${formatNumber(maxBalance, decimals)} ${selectedToken === 'sol' ? 'SOL' : tokenSymbol}`;
    }
    return null;
  }, [amount, maxBalance, selectedToken, tokenSymbol]);

  // Handle MAX button
  const handleMaxClick = useCallback(() => {
    if (maxBalance > 0) {
      setAmount(maxBalance.toString());
    } else {
      toast.error(`No ${selectedToken === 'sol' ? 'SOL' : tokenSymbol} balance available`);
    }
  }, [maxBalance, selectedToken, tokenSymbol]);

  // Handle deposit
  const handleDeposit = useCallback(async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!walletAddress) {
      toast.error('No wallet address found');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (balanceError) {
      toast.error(balanceError);
      return;
    }

    setIsDepositing(true);
    const toastId = toast.loading(`Depositing ${amount} ${selectedToken === 'sol' ? 'SOL' : tokenSymbol}...`);

    try {
      // Convert amount to smallest units
      const decimals = selectedToken === 'sol' ? SOL_DECIMALS : ZC_DECIMALS;
      const amountInSmallestUnits = Math.floor(parseFloat(amount) * Math.pow(10, decimals));

      // Determine vault type based on token type
      const vaultType = selectedToken === 'zc' ? VaultType.Base : VaultType.Quote;

      // Execute deposit (split) using client-side SDK
      await deposit(
        new PublicKey(vaultPDA),
        vaultType,
        amountInSmallestUnits,
        new PublicKey(walletAddress),
        signTransaction
      );

      // Success
      toast.success(`Successfully deposited ${amount} ${selectedToken === 'sol' ? 'SOL' : tokenSymbol}!`, { id: toastId, duration: 5000 });
      setAmount('');
      onDepositSuccess();

    } catch (error) {
      console.error('Deposit error:', error);
      toast.error(
        `Failed to deposit: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { id: toastId }
      );
    } finally {
      setIsDepositing(false);
    }
  }, [authenticated, walletAddress, amount, balanceError, selectedToken, signTransaction, vaultPDA, login, onDepositSuccess]);

  // Handle withdraw
  const handleWithdraw = useCallback(async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!walletAddress) {
      toast.error('No wallet address found');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (balanceError) {
      toast.error(balanceError);
      return;
    }

    setIsDepositing(true);
    const toastId = toast.loading(`Withdrawing ${amount} ${selectedToken === 'sol' ? 'SOL' : tokenSymbol}...`);

    try {
      // Convert amount to smallest units
      const decimals = selectedToken === 'sol' ? SOL_DECIMALS : ZC_DECIMALS;
      const amountInSmallestUnits = Math.floor(parseFloat(amount) * Math.pow(10, decimals));

      // Determine vault type based on token type
      const vaultType = selectedToken === 'zc' ? VaultType.Base : VaultType.Quote;

      // Execute withdraw (merge) using client-side SDK
      await withdraw(
        new PublicKey(vaultPDA),
        vaultType,
        amountInSmallestUnits,
        new PublicKey(walletAddress),
        signTransaction
      );

      // Success
      toast.success(`Successfully withdrew ${amount} ${selectedToken === 'sol' ? 'SOL' : tokenSymbol}!`, { id: toastId, duration: 5000 });
      setAmount('');
      onDepositSuccess();

    } catch (error) {
      console.error('Withdraw error:', error);
      toast.error(
        `Failed to withdraw: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { id: toastId }
      );
    } finally {
      setIsDepositing(false);
    }
  }, [authenticated, walletAddress, amount, balanceError, selectedToken, signTransaction, vaultPDA, login, onDepositSuccess]);

  return (
    <div className="bg-[#121212] border border-[#191919] rounded-[9px] pt-2.5 pb-4 px-5 transition-all duration-300">
      <div className="text-white flex flex-col items-center">
        <div className="flex items-center justify-center gap-2 w-full mb-4.5">
          <span className="md:hidden text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase block" style={{ color: '#DDDDD7' }}>
            I. {mode === 'deposit' ? 'Deposit' : 'Withdraw'}
          </span>
          <span className="hidden md:block text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase" style={{ color: '#DDDDD7' }}>
            I. {mode === 'deposit' ? 'Deposit' : 'Withdraw'} Funds
          </span>

          {/* Pill Toggle */}
          <div className="flex items-center gap-[2px] p-[3px] border border-[#191919] rounded-full">
            <button
              onClick={() => {
                setMode('deposit');
                setAmount('');
              }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer font-ibm-plex-mono ${
                mode === 'deposit'
                  ? 'bg-[#DDDDD7]'
                  : 'bg-transparent'
              }`}
              style={mode === 'deposit' ? { color: '#161616', fontFamily: 'IBM Plex Mono, monospace' } : { color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
            >
              Deposit
            </button>
            <button
              onClick={() => {
                setMode('withdraw');
                setAmount('');
              }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer font-ibm-plex-mono ${
                mode === 'withdraw'
                  ? 'bg-[#DDDDD7]'
                  : 'bg-transparent'
              }`}
              style={mode === 'withdraw' ? { color: '#161616', fontFamily: 'IBM Plex Mono, monospace' } : { color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
            >
              Withdraw
            </button>
          </div>
        </div>

        {/* Input and Button Row */}
        <div className="flex items-center gap-2 w-full pb-1">
        {/* Amount Input */}
        <div className="relative flex-1">
          <input
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.]?[0-9]*"
            autoComplete="off"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            value={amount}
            onChange={(e) => {
              const value = e.target.value;
              if (value === '' || /^\d*\.?\d*$/.test(value)) {
                const numValue = parseFloat(value);
                if (!isNaN(numValue) && numValue > maxBalance) {
                  setAmount(maxBalance.toFixed(3));
                } else {
                  setAmount(value);
                }
              }
            }}
            placeholder={!authenticated ? "LOG IN" : "0.0"}
            disabled={!authenticated}
            className={`w-full h-[56px] px-3 pr-22 bg-[#2a2a2a] rounded-[6px] text-white placeholder-gray-600 focus:outline-none border border-[#191919] text-2xl font-ibm-plex-mono ${
              !authenticated ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            style={{ WebkitAppearance: 'none', MozAppearance: 'textfield', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button
              onClick={handleMaxClick}
              className="px-2 h-7 rounded hover:bg-[#404040] transition cursor-pointer text-xs text-[#AFAFAF] font-medium"
            >
              MAX
            </button>
            <button
              onClick={() => setSelectedToken(selectedToken === 'sol' ? 'zc' : 'sol')}
              className="flex items-center justify-center px-2 h-7 bg-[#333] rounded hover:bg-[#404040] transition cursor-pointer"
            >
              {selectedToken === 'sol' ? (
                <span className="text-xs text-[#AFAFAF] font-bold">SOL</span>
              ) : (
                <span className="text-xs text-[#AFAFAF] font-bold">{tokenSymbol}</span>
              )}
            </button>
          </div>
        </div>

        {/* Deposit/Withdraw Button */}
        <button
          onClick={!authenticated ? login : (mode === 'deposit' ? handleDeposit : handleWithdraw)}
          disabled={authenticated && (!amount || parseFloat(amount) <= 0 || isDepositing || !!balanceError)}
          className={`h-[56px] w-[100px] md:w-[140px] px-4 md:px-6 rounded-[6px] font-semibold transition cursor-pointer whitespace-nowrap uppercase font-ibm-plex-mono text-md flex items-center justify-center ${
            !authenticated || (amount && parseFloat(amount) > 0 && !balanceError && !isDepositing)
              ? 'bg-[#DDDDD7]'
              : 'bg-[#414346] cursor-not-allowed'
          }`}
          style={{ color: '#161616', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}
        >
          {isDepositing ? (
            <div className="animate-spin h-4 w-4 rounded-full border-2 border-[#161616] border-t-transparent"></div>
          ) : !authenticated ? (
            'LOG IN'
          ) : (
            mode === 'deposit' ? 'DEPOSIT' : 'WITHDRAW'
          )}
        </button>
        </div>
      </div>
    </div>
  );
}
