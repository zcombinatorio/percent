import React from 'react';

interface ProposalContent {
  id: number;
  title: string;
  content: React.ReactNode;
}

export const proposalContentMap: Record<number, ProposalContent> = {
  0: {
    id: 0,
    title: "What is the price of $ZC after OOG-1 settles?",
    content: (
      <div className="space-y-4 text-gray-300">
        <p>
          Mint 5,000,000 $ZC, stake them in the $ZC vault and distribute staked tokens proportionally based on wallet volume to all traders of this decision market.
        </p>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">How is volume calculated?</h3>
          <p>
            All trading volume on the pass and fail markets occurring before the implied resolution on either the pass or fail markets is counted towards the reward calculation. Volume is calculated as if both pass and fail markets resolve.
          </p>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">What is implied resolution?</h3>
          <p>
            Implied resolution occurs once the pass-fail gap is sufficiently large such that no additional price movement can change the outcome of the market. This is an anti-manipulation feature.
          </p>
        </div>

        <p>
          The proposal passes if pass-fail gap &gt; 3%. Pass-fail gap is calculated using TWAP
        </p>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">I need help - who can I talk to?</h3>
          <p>
            Come join our telegram: <a href="https://t.me/oogwayexperimentportal" className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">https://t.me/oogwayexperimentportal</a>
          </p>
        </div>
      </div>
    )
  },
  2: {
    id: 2,
    title: "ZC-1: Update Staking Vault Rewards & Parameters",
    content: (
      <div className="space-y-4 text-gray-300">
        <div>
          <h3 className="text-lg font-semibold text-white mb-2">Summary</h3>
          <p>
            Adjust the $ZC staking vault to align incentives with longer-term staking and simplify user operations.
          </p>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">Changes Proposed</h3>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Epoch length:</strong> increase from 14 days to 30 days (monthly withdrawal period)</li>
            <li><strong>Emissions:</strong> increase from 14M $ZC / 14 days to 60M $ZC / 30 days</li>
            <li><strong>One-time early exit window:</strong> upon execution, open withdrawals for 36 hours, then close until the first monthly epoch end</li>
            <li><strong>Passing criterion:</strong> proposal passes only if the pass–fail gap TWAP &gt; 0% over the voting period</li>
            <li><strong>Reward pause during window:</strong> pause reward emissions (no accrual) during the 36-hour withdrawal window</li>
          </ul>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">Motivation</h3>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Longer commitment, clearer cadence:</strong> monthly epochs reduce operational churn vs biweekly</li>
            <li><strong>Strengthen incentives:</strong> doubles daily emissions to reward long-term participation and increase the staked share</li>
            <li><strong>Graceful transition:</strong> an early withdrawal window plus an emissions pause prevents "trapped" liquidity and removes timing edge cases</li>
          </ul>
        </div>

        <p>
          The proposal passes if pass-fail gap &gt; 0%. Pass-fail gap is calculated using TWAP.
        </p>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">I need help - who can I talk to?</h3>
          <p>
            Come join our Discord: <a href="https://discord.gg/Vf38Mqhxu5" className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">https://discord.gg/Vf38Mqhxu5</a>
          </p>
        </div>
      </div>
    )
  },
  3: {
    id: 3,
    title: "ZC-1: Update Staking Vault Rewards & Parameters",
    content: (
      <div className="space-y-4 text-gray-300">
        <div>
          <h3 className="text-lg font-semibold text-white mb-2">Summary</h3>
          <p>
            Adjust the $ZC staking vault to align incentives with longer-term staking and simplify user operations.
          </p>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">Changes Proposed</h3>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Epoch length:</strong> increase from 14 days to 30 days (monthly withdrawal period)</li>
            <li><strong>Emissions:</strong> increase from 14M $ZC / 14 days to 60M $ZC / 30 days</li>
            <li><strong>One-time early exit window:</strong> upon execution, open withdrawals for 36 hours, then close until the first monthly epoch end</li>
            <li><strong>Passing criterion:</strong> proposal passes only if the pass–fail gap TWAP &gt; 0% over the voting period</li>
            <li><strong>Reward pause during window:</strong> pause reward emissions (no accrual) during the 36-hour withdrawal window</li>
          </ul>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">Motivation</h3>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Longer commitment, clearer cadence:</strong> monthly epochs reduce operational churn vs biweekly</li>
            <li><strong>Strengthen incentives:</strong> doubles daily emissions to reward long-term participation and increase the staked share</li>
            <li><strong>Graceful transition:</strong> an early withdrawal window plus an emissions pause prevents "trapped" liquidity and removes timing edge cases</li>
          </ul>
        </div>

        <p>
          The proposal passes if pass-fail gap &gt; 0%. Pass-fail gap is calculated using TWAP.
        </p>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">I need help - who can I talk to?</h3>
          <p>
            Come join our Discord: <a href="https://discord.gg/Vf38Mqhxu5" className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">https://discord.gg/Vf38Mqhxu5</a>
          </p>
        </div>
      </div>
    )
  },
  6: {
    id: 6,
    title: "What is the price of $ZC after OOG-1 settles?",
    content: (
      <div className="space-y-4 text-gray-300">
        <p>
          Mint 5,000,000 $ZC, stake them in the $ZC vault and distribute staked tokens proportionally based on wallet volume to all traders of this decision market.
        </p>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">How is volume calculated?</h3>
          <p>
            All trading volume on the pass and fail markets occurring before the implied resolution on either the pass or fail markets is counted towards the reward calculation. Volume is calculated as if both pass and fail markets resolve.
          </p>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">What is implied resolution?</h3>
          <p>
            Implied resolution occurs once the pass-fail gap is sufficiently large such that no additional price movement can change the outcome of the market. This is an anti-manipulation feature.
          </p>
        </div>

        <p>
          The proposal passes if pass-fail gap &gt; 3%. Pass-fail gap is calculated using TWAP
        </p>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">I need help - who can I talk to?</h3>
          <p>
            Come join our telegram: <a href="https://t.me/oogwayexperimentportal" className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">https://t.me/oogwayexperimentportal</a>
          </p>
        </div>
      </div>
    )
  },
  7: {
    id: 7,
    title: "What will the price of $ZC be after the OOG-2 market resolves?",
    content: (
      <div className="space-y-4 text-gray-300">
        <p className="font-semibold">
          OOG-2: Create an $ZC-sZC LP via meteora DAMM V2
        </p>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">Mint</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>40,000,000 $ZC for the purpose of creating a liquid sZC token</li>
            <li>10,000,000 $ZC to be distributed to traders of this market. distribution will be volume based and in the form of staked ZC</li>
          </ul>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">Pros:</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>$ZC stakers, who no longer want to signal commitment, can exit at a discount to $ZC.</li>
            <li>$ZC holders interested in signaling commitment, can purchase $ZC at discounts by purchasing staked $ZC</li>
            <li>decision markets can be set up on staked $ZC instead of $ZC</li>
            <li>removes deferred selling upon end of staking period</li>
            <li>increased volume on the native trading pool</li>
            <li>pricing of staked $ZC APY is more accurate</li>
          </ul>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">Cons:</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>staking market becomes less restrictive</li>
            <li>complicated mechanisms increase overhead</li>
          </ul>
        </div>

        <p className="text-sm italic">
          Trading this decision market incurs financial risk.
        </p>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">How is volume calculated?</h3>
          <p>
            All trading volume on the pass and fail markets occurring before the implied resolution on either the pass or fail markets is counted towards the reward calculation. Volume is calculated as if both pass and fail markets resolve.
          </p>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">What is implied resolution?</h3>
          <p>
            Implied resolution occurs once the pass-fail gap is sufficiently large such that no additional price movement can change the outcome of the market. This is an anti-manipulation feature.
          </p>
        </div>

        <p>
          The proposal passes if pass-fail gap &gt; 1%. Pass-fail gap is calculated using TWAP.
        </p>

        <div>
          <h3 className="text-lg font-semibold text-white mb-2">I need help - who can I talk to?</h3>
          <p>
            Come join our telegram: <a href="https://t.me/oogwayexperimentportal" className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">https://t.me/oogwayexperimentportal</a>
          </p>
        </div>
      </div>
    )
  }
};

export function getProposalContent(proposalId: number, defaultDescription?: string) {
  const content = proposalContentMap[proposalId];

  if (content) {
    return {
      title: content.title,
      content: content.content
    };
  }

  // Fallback for proposals without custom content
  return {
    title: defaultDescription || `Proposal #${proposalId}`,
    content: null
  };
}
