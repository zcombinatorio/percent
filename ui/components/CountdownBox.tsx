import { CountdownTimer } from './CountdownTimer';
import type { ProposalStatus } from '@/types/api';

interface CountdownBoxProps {
  finalizedAt: number;
  status: ProposalStatus;
  onTimerEnd?: () => void;
}

export function CountdownBox({ finalizedAt, status, onTimerEnd }: CountdownBoxProps) {
  return (
    <div className="bg-theme-card border border-theme-border rounded-[9px] py-3 px-5 hover:border-theme-border-hover transition-all duration-300">
      <div className="text-theme-text flex flex-col">
        <span className="text-sm text-theme-text font-semibold uppercase mb-6">Time Left</span>
        <span className="text-sm text-theme-text-secondary font-mono">
          <CountdownTimer
            endsAt={finalizedAt}
            onTimerEnd={onTimerEnd}
            isPending={status === 'Pending'}
          />
        </span>
      </div>
    </div>
  );
}
