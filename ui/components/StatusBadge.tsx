import type { ProposalStatus } from '@/types/api';

interface StatusBadgeProps {
  status: ProposalStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`text-xs px-2 py-1 rounded-full inline-flex items-center gap-1 ${
      status === 'Pending'
        ? 'bg-orange-400/20 text-orange-400 animate-pulse'
        : status === 'Passed'
        ? 'bg-emerald-400/20 text-emerald-400'
        : 'bg-rose-400/20 text-rose-400'
    }`}>
      {status === 'Pending' ? 'Live' : status}
      {status === 'Pending' && (
        <span className="relative w-3 h-3 flex items-center justify-center">
          <span className="absolute w-3 h-3 bg-orange-400 rounded-full animate-ping opacity-75"></span>
          <span className="relative w-2 h-2 bg-orange-400 rounded-full"></span>
        </span>
      )}
      {status === 'Passed' && (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      )}
      {status === 'Failed' && (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
      )}
    </span>
  );
}
