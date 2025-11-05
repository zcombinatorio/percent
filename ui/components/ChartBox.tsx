import MarketChart from './MarketChart';

interface ChartBoxProps {
  proposalId: number;
  selectedMarket: 'pass' | 'fail';
}

export function ChartBox({ proposalId, selectedMarket }: ChartBoxProps) {
  return (
    <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300">
      <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-6 block" style={{ color: '#DDDDD7' }}>
        {selectedMarket === 'pass' ? 'Chart: Pass Coin' : 'Chart: Fail Coin'}
      </span>
      <div className="bg-[#121212] border border-[#191919] overflow-hidden rounded-[6px]">
        <MarketChart proposalId={proposalId} market={selectedMarket} height={620} />
      </div>
    </div>
  );
}
