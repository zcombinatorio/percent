'use client';

import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePrivyWallet } from '@/hooks/usePrivyWallet';
import { useSolanaWallets } from '@privy-io/react-auth/solana';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useTokenContext } from '@/providers/TokenContext';
import { api } from '@/lib/api';
import Header from '@/components/Header';
import EditableFlipCard from '@/components/EditableFlipCard';
import toast from 'react-hot-toast';
import bs58 from 'bs58';

export default function CreatePage() {
  const searchParams = useSearchParams();
  const { ready, authenticated, user, walletAddress, login } = usePrivyWallet();
  const { wallets } = useSolanaWallets();
  const { tokenSlug, poolAddress, poolMetadata, baseMint, baseDecimals, tokenSymbol, moderatorId, icon, isLoading: poolLoading } = useTokenContext();
  const { sol: solBalance, baseToken: baseTokenBalance } = useWalletBalances({
    walletAddress,
    baseMint,
    baseDecimals,
  });
  const hasWalletBalance = solBalance > 0 || baseTokenBalance > 0;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [choices, setChoices] = useState<string[]>(['']); // Custom choices (Choice 1 "No" is hardcoded)
  const [selectedChoiceIndex, setSelectedChoiceIndex] = useState(0); // 0 = "No", 1+ = custom choices
  const [isChoiceInputFocused, setIsChoiceInputFocused] = useState(false);
  const [proposalLengthHours, setProposalLengthHours] = useState('24');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [isReportStaker, setIsReportStaker] = useState(false);
  const [proposalSubmitted, setProposalSubmitted] = useState(false);

  // Check for reportStaker query parameter and auto-activate toggle
  useEffect(() => {
    if (searchParams.get('reportStaker') === 'true' && !isReportStaker) {
      // Trigger the toggle to auto-fill the form
      setIsReportStaker(true);
      setTitle('Should we slash Staker [paste wallet here]?');
      setDescription("I believe [paste wallet here] is not fulfilling their Staker's obligation because...");
      setChoices(['20%', '40%', '60%', '80%', '100%']);
      setSelectedChoiceIndex(0);
    }
  }, [searchParams]);

  // Report Staker toggle handler - auto-fills or clears form
  const handleReportStakerToggle = () => {
    if (isSubmitting) return;

    const newValue = !isReportStaker;
    setIsReportStaker(newValue);

    if (newValue) {
      // Auto-fill form for reporting a staker
      setTitle('Should we slash Staker [paste wallet here]?');
      setDescription("I believe [paste wallet here] is not fulfilling their Staker's obligation because...");
      setChoices(['20%', '40%', '60%', '80%', '100%']);
      setSelectedChoiceIndex(0);
    } else {
      // Clear form
      setTitle('');
      setDescription('');
      setChoices(['']);
      setSelectedChoiceIndex(0);
    }
  };

  // Choice management helpers
  const MAX_CHOICES = 7; // 8 markets total including "No"
  const addChoice = () => {
    if (choices.length < MAX_CHOICES) {
      setChoices([...choices, '']);
    }
  };
  const removeChoice = (index: number) => {
    if (choices.length > 1) {
      setChoices(choices.filter((_, i) => i !== index));
      // Adjust selected index if needed
      if (selectedChoiceIndex > index + 1) {
        setSelectedChoiceIndex(selectedChoiceIndex - 1);
      } else if (selectedChoiceIndex === index + 1 && index + 1 >= choices.length) {
        setSelectedChoiceIndex(Math.max(1, choices.length - 1));
      }
    }
  };
  const updateChoice = (index: number, value: string) => {
    setChoices(choices.map((c, i) => i === index ? value : c));
  };

  // Refs for flip card inputs to manage auto-focus
  const firstDigitRef = useRef<HTMLInputElement>(null);
  const secondDigitRef = useRef<HTMLInputElement>(null);

  // Ref for choice input to maintain focus when navigating
  const choiceInputRef = useRef<HTMLInputElement>(null);

  // Track if we should maintain focus after re-render
  const shouldMaintainFocus = useRef(false);

  // Effect to maintain focus on choice input after state changes
  useEffect(() => {
    if (shouldMaintainFocus.current && choiceInputRef.current) {
      choiceInputRef.current.focus();
      setIsChoiceInputFocused(true);
      shouldMaintainFocus.current = false;
    }
  }, [selectedChoiceIndex, choices]);

  // Check if wallet is authorized for THIS specific pool
  useEffect(() => {
    const checkAuth = async () => {
      if (!walletAddress || !poolAddress) {
        setIsAuthorized(false);
        setAuthLoading(false);
        return;
      }

      setAuthLoading(true);
      try {
        const result = await api.getPoolByNameWithAuth(tokenSlug, walletAddress);
        setIsAuthorized(result?.isAuthorized || false);
      } catch {
        setIsAuthorized(false);
      } finally {
        setAuthLoading(false);
      }
    };

    checkAuth();
  }, [walletAddress, poolAddress, tokenSlug]);

  const hasPermission = isAuthorized;
  // For /zc/, logged-in users can propose even if not whitelisted
  const canPropose = tokenSlug === 'zc' && walletAddress && !isAuthorized;
  // For button text: show "PROPOSE" for /zc/ when not authorized (regardless of login state)
  const showProposeText = tokenSlug === 'zc' && !isAuthorized;
  const poolName = poolMetadata?.ticker?.toUpperCase() || tokenSlug.toUpperCase();

  // Check if form is valid (title, description, at least first custom choice, and duration filled)
  const isFormInvalid = !title.trim() || !description.trim() || !choices[0]?.trim() || parseFloat(proposalLengthHours) <= 0;

  // Handle proposal submission for non-whitelisted users
  const handlePropose = async () => {
    if (!walletAddress) {
      toast.error('Wallet not connected');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading('Sign the message in your wallet...');

    try {
      // Get wallet for signing
      const wallet = wallets[0];
      if (!wallet) {
        toast.error('No Solana wallet found', { id: toastId });
        setIsSubmitting(false);
        return;
      }

      // Generate message to sign (proves wallet ownership)
      const messageObj = {
        action: 'propose',
        timestamp: Date.now(),
        nonce: crypto.randomUUID()
      };
      const message = JSON.stringify(messageObj);

      // Request user to sign message
      let signatureBytes: Uint8Array;
      try {
        const messageBytes = new TextEncoder().encode(message);
        signatureBytes = await wallet.signMessage(messageBytes);
      } catch (signError) {
        console.error('Signature rejected:', signError);
        toast.error('Signature rejected by user', { id: toastId });
        setIsSubmitting(false);
        return;
      }

      // Encode signature as base58
      const signature = bs58.encode(signatureBytes);

      toast.loading('Submitting proposal...', { id: toastId });

      const response = await fetch('/api/proposal-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          submitterWallet: walletAddress,
          title: title.trim(),
          description: description.trim(),
          choices: ['No', ...choices.filter(c => c.trim()).map(c => c.trim())],
          proposalLengthHours: parseFloat(proposalLengthHours),
          isReportStaker,
          signature,
          message,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to submit proposal');
      }

      toast.success('Proposal submitted!', { id: toastId });

      // Show "Proposal submitted" for 2 seconds
      setProposalSubmitted(true);

      // Reset form
      setTitle('');
      setDescription('');
      setChoices(['']);
      setSelectedChoiceIndex(0);
      setProposalLengthHours('24');
      setIsReportStaker(false);

      // Reset button after 2 seconds
      setTimeout(() => {
        setProposalSubmitted(false);
      }, 2000);

    } catch (error) {
      console.error('Proposal submission failed:', error);
      toast.error(
        `Failed to submit proposal: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { id: toastId }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!description.trim()) {
      toast.error('Description is required');
      return;
    }
    if (!choices[0]?.trim()) {
      toast.error('At least one custom choice is required (Choice 2)');
      return;
    }
    const hours = parseFloat(proposalLengthHours);
    if (!hours || hours <= 0) {
      toast.error('Proposal length must be a positive number');
      return;
    }
    if (!poolAddress) {
      toast.error('Pool not loaded');
      return;
    }
    if (!walletAddress) {
      toast.error('Wallet not connected');
      return;
    }
    if (!moderatorId) {
      toast.error('Pool configuration not loaded');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading('Sign the attestation in your wallet...');

    try {
      // Get wallet for signing
      const wallet = wallets[0];
      if (!wallet) {
        toast.error('No Solana wallet found', { id: toastId });
        setIsSubmitting(false);
        return;
      }

      // Generate attestation message
      const attestation = {
        action: 'withdraw',
        poolAddress: poolAddress,
        timestamp: Date.now(),
        nonce: crypto.randomUUID()
      };
      const attestationMessage = JSON.stringify(attestation);

      // Request user to sign attestation
      let signatureBytes: Uint8Array;
      try {
        const messageBytes = new TextEncoder().encode(attestationMessage);
        signatureBytes = await wallet.signMessage(messageBytes);
      } catch (signError) {
        console.error('Signature rejected:', signError);
        toast.error('Signature rejected by user', { id: toastId });
        setIsSubmitting(false);
        return;
      }

      // Encode signature as base58
      const creatorSignature = bs58.encode(signatureBytes);

      // Update loading message
      toast.loading('Creating Quantum Market...', { id: toastId });

      // Convert hours to seconds
      const proposalLength = Math.floor(hours * 3600);

      // Build market_labels array: index 0 = "No", then all non-empty custom choices
      const market_labels = ['No', ...choices.filter(c => c.trim()).map(c => c.trim())];
      const markets = market_labels.length;

      const requestBody = {
        title: title.trim(),
        description: description.trim(),
        proposalLength,
        markets,
        market_labels,
        spotPoolAddress: poolAddress,
        creatorWallet: walletAddress,
        creatorSignature,
        attestationMessage
      };

      const response = await fetch(`/api/proposals?moderatorId=${moderatorId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create QM');
      }

      const data = await response.json();

      toast.success(
        `Proposal #${data.id} created successfully!`,
        { id: toastId }
      );

      // Reset form
      setTitle('');
      setDescription('');
      setChoices(['']);
      setSelectedChoiceIndex(0);
      setProposalLengthHours('24');

    } catch (error) {
      console.error('Create QM failed:', error);
      toast.error(
        `Failed to create QM: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { id: toastId }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const stillLoading = !ready || poolLoading || (walletAddress && authLoading);

  return (
    <div className="flex h-screen" style={{ backgroundColor: '#0a0a0a' }}>
      <div className="flex-1 flex flex-col">
        <Header
          walletAddress={walletAddress}
          authenticated={authenticated}
          solBalance={solBalance}
          baseTokenBalance={baseTokenBalance}
          hasWalletBalance={hasWalletBalance}
          login={login}
          isPassMode={true}
          tokenSlug={tokenSlug}
          tokenSymbol={tokenSymbol}
          tokenIcon={icon}
          poolAddress={poolAddress}
          baseMint={baseMint}
          isCreateAuthorized={tokenSlug !== 'zc' || isAuthorized}
        />

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex justify-center overflow-y-auto">
            <div className="w-full max-w-[1332px] 2xl:max-w-[1512px] pt-8 pb-16 md:pb-8 px-4 md:px-0">
              <div className="mb-6">
                <h2 className="text-2xl font-medium" style={{ color: '#E9E9E3' }}>
                  {tokenSlug === 'zc' && !isAuthorized ? 'Propose' : 'Create'} Quantum Market
                </h2>
              </div>

              {stillLoading ? (
                <div className="flex items-center justify-center py-16">
                  <p style={{ color: '#6B6E71' }}>Checking permissions...</p>
                </div>
              ) : (
              <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  {/* Left Column (3/5 width) */}
                  <div className="md:col-span-3 flex flex-col gap-4 md:pb-12">
                    {/* Title Card */}
                    <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase" style={{ color: '#DDDDD7' }}>
                          Proposal*
                        </span>
                        {/* Report Staker Toggle */}
                        <div
                          onClick={handleReportStakerToggle}
                          className="flex items-center p-[3px] border border-[#191919] rounded-full cursor-pointer"
                        >
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-medium font-ibm-plex-mono ${
                              isReportStaker ? 'bg-[#DDDDD7]' : 'bg-transparent'
                            }`}
                            style={{ color: isReportStaker ? '#161616' : '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
                          >
                            Report Staker
                          </span>
                        </div>
                      </div>
                      <input
                        id="title"
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Mint $ZC as reward for next Combinator founder?"
                        className="w-full h-[56px] px-3 bg-[#2a2a2a] rounded-[6px] text-white placeholder-gray-600 focus:outline-none border border-[#191919] text-2xl font-ibm-plex-mono"
                        style={{
                          WebkitAppearance: 'none',
                          MozAppearance: 'textfield',
                          fontFamily: 'IBM Plex Mono, monospace',
                          letterSpacing: '0em'
                        }}
                        disabled={isSubmitting}
                      />
                    </div>

                    {/* Description Card */}
                    <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 flex-1 flex flex-col relative">
                      <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-4 block" style={{ color: '#DDDDD7' }}>
                        Description*
                      </span>
                      <textarea
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="For Combinator to be successful, it needs launchers. Providing a $ZC incentive will assist with this effort."
                        className="w-full flex-1 px-3 py-3 bg-[#2a2a2a] rounded-[6px] text-white placeholder-gray-600 focus:outline-none border border-[#191919] text-2xl font-ibm-plex-mono resize-none"
                        style={{
                          WebkitAppearance: 'none',
                          fontFamily: 'IBM Plex Mono, monospace',
                          letterSpacing: '0em'
                        }}
                        disabled={isSubmitting}
                      />
                    </div>

                    {/* Choices Card - Single card with dot navigation */}
                    <div
                      className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 focus:outline-none"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        const totalChoices = choices.length + 1; // +1 for "No"
                        if (e.key === 'ArrowRight') {
                          e.preventDefault();
                          setSelectedChoiceIndex((prev) => Math.min(prev + 1, totalChoices - 1));
                        } else if (e.key === 'ArrowLeft') {
                          e.preventDefault();
                          setSelectedChoiceIndex((prev) => Math.max(prev - 1, 0));
                        } else if (e.key === 'Enter' && selectedChoiceIndex > 0 && choices.length < MAX_CHOICES) {
                          e.preventDefault();
                          addChoice();
                          setSelectedChoiceIndex(choices.length + 1);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase" style={{ color: '#DDDDD7' }}>
                          Choice {selectedChoiceIndex + 1}{selectedChoiceIndex === 1 ? '*' : ''}
                        </span>

                        {/* Navigation Dots */}
                        <div className="flex items-center gap-1.5">
                          {/* Dot for each choice (0 = "No", 1+ = custom choices) */}
                          {['No', ...choices].map((_, index) => (
                            <button
                              key={index}
                              type="button"
                              onClick={() => setSelectedChoiceIndex(index)}
                              className={`h-2.5 rounded-full transition-all cursor-pointer ${
                                selectedChoiceIndex === index
                                  ? 'w-8 bg-[#DDDDD7]'
                                  : 'w-2.5 bg-[#414346] hover:bg-[#6B6E71]'
                              }`}
                              title={`Choice ${index + 1}`}
                            />
                          ))}

                        </div>
                      </div>

                      {/* Input - shows current selected choice */}
                      <div className="relative">
                        {selectedChoiceIndex === 0 ? (
                          <input
                            ref={choiceInputRef}
                            type="text"
                            value="No"
                            readOnly
                            onFocus={() => setIsChoiceInputFocused(true)}
                            onBlur={() => setIsChoiceInputFocused(false)}
                            onKeyDown={(e) => {
                              const totalChoices = choices.length + 1; // +1 for "No"
                              if (e.key === 'ArrowRight') {
                                e.preventDefault();
                                e.stopPropagation();
                                shouldMaintainFocus.current = true;
                                setSelectedChoiceIndex((prev) => Math.min(prev + 1, totalChoices - 1));
                              } else if (e.key === 'ArrowLeft') {
                                e.preventDefault();
                                e.stopPropagation();
                                shouldMaintainFocus.current = true;
                                setSelectedChoiceIndex((prev) => Math.max(prev - 1, 0));
                              }
                            }}
                            className="w-full h-[56px] px-3 bg-[#1a1a1a] rounded-[6px] text-gray-400 focus:outline-none border border-[#191919] text-2xl font-ibm-plex-mono"
                            style={{
                              WebkitAppearance: 'none',
                              MozAppearance: 'textfield',
                              fontFamily: 'IBM Plex Mono, monospace',
                              letterSpacing: '0em'
                            }}
                          />
                        ) : (
                          <input
                            ref={choiceInputRef}
                            type="text"
                            value={choices[selectedChoiceIndex - 1] || ''}
                            onChange={(e) => {
                              shouldMaintainFocus.current = true;
                              updateChoice(selectedChoiceIndex - 1, e.target.value);
                            }}
                            onFocus={() => setIsChoiceInputFocused(true)}
                            onBlur={() => setIsChoiceInputFocused(false)}
                            onKeyDown={(e) => {
                              const totalChoices = choices.length + 1; // +1 for "No"
                              if (e.key === 'ArrowRight') {
                                e.preventDefault();
                                e.stopPropagation();
                                shouldMaintainFocus.current = true;
                                setSelectedChoiceIndex((prev) => Math.min(prev + 1, totalChoices - 1));
                              } else if (e.key === 'ArrowLeft') {
                                e.preventDefault();
                                e.stopPropagation();
                                shouldMaintainFocus.current = true;
                                setSelectedChoiceIndex((prev) => Math.max(prev - 1, 0));
                              } else if (e.key === 'Enter' && choices.length < MAX_CHOICES) {
                                e.preventDefault();
                                e.stopPropagation();
                                shouldMaintainFocus.current = true;
                                addChoice();
                                setSelectedChoiceIndex(choices.length + 1);
                              }
                            }}
                            placeholder={selectedChoiceIndex === 1 ? "1.5M $ZC" : selectedChoiceIndex === 2 ? "3M $ZC" : "5M $ZC"}
                            className={`w-full h-[56px] px-3 bg-[#2a2a2a] rounded-[6px] text-white placeholder-gray-600 focus:outline-none border border-[#191919] text-2xl font-ibm-plex-mono ${
                              selectedChoiceIndex > 1 && choices.length > 1 ? 'pr-12' : ''
                            }`}
                            style={{
                              WebkitAppearance: 'none',
                              MozAppearance: 'textfield',
                              fontFamily: 'IBM Plex Mono, monospace',
                              letterSpacing: '0em'
                            }}
                            disabled={isSubmitting}
                          />
                        )}

                        {/* Hint text - show when focused on last custom choice and can add more */}
                        {isChoiceInputFocused && selectedChoiceIndex === choices.length && choices.length < MAX_CHOICES && (
                          <span
                            className={`absolute top-1/2 -translate-y-1/2 text-[#414346] text-2xl font-ibm-plex-mono pointer-events-none ${
                              selectedChoiceIndex > 0 && choices.length > 1 ? 'right-12' : 'right-3'
                            }`}
                            style={{ fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}
                          >
                            [Enter]
                          </span>
                        )}

                        {/* Delete button - show on any custom choice when there are multiple custom choices */}
                        {selectedChoiceIndex > 0 && choices.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeChoice(selectedChoiceIndex - 1)}
                            disabled={isSubmitting}
                            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-[#3a3a3a] hover:bg-[#4a4a4a] text-[#6B6E71] hover:text-[#DDDDD7] transition-colors cursor-pointer"
                            title="Remove choice"
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column (2/5 width) */}
                  <div className="md:col-span-2 flex flex-col gap-4 pb-12 md:pb-12">
                    {/* Proposal Length Card */}
                    <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5">
                      <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-4 block text-center" style={{ color: '#DDDDD7' }}>
                        Duration*
                      </span>

                      {/* Bordered Container for Flip Cards */}
                      <div className="border border-[#191919] rounded-[6px] py-6 px-4">
                        {/* Massive Flip Cards */}
                        <div className="flex items-center justify-center gap-4">
                          <EditableFlipCard
                            ref={firstDigitRef}
                            digit={proposalLengthHours.padStart(2, '0')[0]}
                            onChange={(val) => {
                              const ones = proposalLengthHours.padStart(2, '0')[1];
                              const newHours = parseInt(val + ones) || 0;
                              setProposalLengthHours(newHours.toString());
                            }}
                            onValueEntered={() => {
                              // Auto-focus and select second digit for immediate editing
                              if (secondDigitRef.current) {
                                secondDigitRef.current.focus();
                                secondDigitRef.current.select();
                              }
                            }}
                            disabled={isSubmitting}
                          />
                          <EditableFlipCard
                            ref={secondDigitRef}
                            digit={proposalLengthHours.padStart(2, '0')[1]}
                            onChange={(val) => {
                              const tens = proposalLengthHours.padStart(2, '0')[0];
                              const newHours = parseInt(tens + val) || 0;
                              setProposalLengthHours(newHours.toString());
                            }}
                            disabled={isSubmitting}
                          />
                        </div>

                        <p className="text-sm text-center mt-4" style={{ color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}>
                          Click and type to edit hours.
                        </p>
                      </div>
                    </div>

                    {/* Submit Button Card */}
                    <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5">
                      {/* Bordered Container for Button */}
                      <div className="border border-[#191919] rounded-[6px] py-6 px-4">
                        <button
                          type={canPropose ? 'button' : 'submit'}
                          onClick={canPropose ? handlePropose : undefined}
                          disabled={(!hasPermission && !canPropose) || isSubmitting || isFormInvalid || proposalSubmitted}
                          className={`w-full h-[56px] rounded-full font-semibold transition flex items-center justify-center gap-1 uppercase font-ibm-plex-mono ${
                            (!hasPermission && !canPropose) || isSubmitting || isFormInvalid || proposalSubmitted
                              ? 'bg-[#414346] cursor-not-allowed text-[#181818]'
                              : 'bg-[#DDDDD7] text-[#161616] cursor-pointer'
                          }`}
                        >
                          {proposalSubmitted
                            ? 'PROPOSAL SUBMITTED'
                            : isSubmitting
                              ? `${showProposeText ? 'Proposing' : 'Creating'} ${poolName} QM...`
                              : `${showProposeText ? 'PROPOSE' : 'CREATE'} ${poolName} QM`}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
