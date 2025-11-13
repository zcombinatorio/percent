import { ExternalLink } from "lucide-react"
import { LeaderboardUser, AuthState } from "./types"

interface LeaderboardTableProps {
  leaderboardData: LeaderboardUser[]
  authState: AuthState
  userRank: number | null
  formatNumber: (num: number) => string
}

export default function LeaderboardTable({
  leaderboardData,
  authState,
  userRank,
  formatNumber
}: LeaderboardTableProps) {
  return (
    <div className="border-2 border-white relative p-4" style={{backgroundColor: 'black'}}>
      <div style={{backgroundColor: 'black'}} className="h-full w-full relative">
        {/* Title in border */}
        <div className="absolute -top-7 left-1/2 transform -translate-x-1/2">
          <span className="bg-black px-4 font-mono text-white tracking-wide text-lg">% LEADERBOARD</span>
        </div>
        <div className="pt-8 pb-4 px-6">
        </div>

        {/* Desktop Table View */}
        <div className="hidden sm:block overflow-x-auto px-6 pb-6">
        <table className="w-full font-mono">
          <thead>
            <tr
              style={{backgroundColor: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)'}}
            >
              {['rank', 'handle', 'followers', 'refs', 'indirect', 'score'].map((header) => {
                // Assign highest lightness to 'refs' and 'indirect' columns
                let lightness;
                if (header === 'refs' || header === 'indirect') {
                  lightness = header === 'indirect' ? 1 : 0.9; // Maximum lightness for indirect, high for refs
                } else {
                  // Distribute remaining columns across the gradient
                  const nonRefColumns = ['rank', 'handle', 'followers', 'score'];
                  const nonRefIndex = nonRefColumns.indexOf(header);
                  lightness = nonRefIndex / (nonRefColumns.length - 1) * 0.7; // Scale to 0.7 to leave room for ref columns
                }

                const baseColor = { r: 98, g: 98, b: 98, a: 0.5 };
                const targetColor = { r: 255, g: 255, b: 255, a: 0.45 };

                const interpolatedColor = {
                  r: Math.round(baseColor.r + (targetColor.r - baseColor.r) * lightness),
                  g: Math.round(baseColor.g + (targetColor.g - baseColor.g) * lightness),
                  b: Math.round(baseColor.b + (targetColor.b - baseColor.b) * lightness),
                  a: baseColor.a + (targetColor.a - baseColor.a) * lightness
                };

                const backgroundColor = `rgba(${interpolatedColor.r}, ${interpolatedColor.g}, ${interpolatedColor.b}, ${interpolatedColor.a})`;

                return (
                  <th
                    key={header}
                    className={`${header === 'rank' || header === 'handle' ? 'text-left' : 'text-right'} px-2 py-1 text-xs font-normal transition-colors duration-200`}
                    style={{
                      color: 'white',
                      backgroundColor,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}
                  >
                    {header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* Show logged in user at top with orange border if they exist */}
            {authState.user && userRank && (
              <tr
                key={`current-user-${authState.user.id}`}
                className="border-b transition-colors"
                style={{
                  borderBottomColor: 'rgba(38, 38, 38, 1)',
                  borderColor: '#2d70fa',
                  borderWidth: '2px',
                  backgroundColor: 'rgba(45, 112, 250, 0.1)'
                }}
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-blue-400">
                      {String(userRank).padStart(3, '0')}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm text-blue-400">{authState.user.twitterHandle}</span>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-sm tabular-nums text-white">
                    {formatNumber(authState.user.twitterFollowers)}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-sm tabular-nums text-white">
                    +{leaderboardData.find(u => u.twitterHandle === authState.user?.twitterHandle)?.referralCount || 0}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-sm tabular-nums text-white">
                    +{leaderboardData.find(u => u.twitterHandle === authState.user?.twitterHandle)?.indirectReferralCount || 0}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-sm font-medium tabular-nums" style={{color: 'rgb(92, 255, 59)'}}>
                    {formatNumber(Math.round((leaderboardData.find(u => u.twitterHandle === authState.user?.twitterHandle)?.totalScore || 0) * 100))}
                  </span>
                </td>
              </tr>
            )}

            {leaderboardData.map((user) => {
              const isCurrentUser = authState.user && user.twitterHandle === authState.user.twitterHandle;
              const shouldBlur = user.rank > 10;

              // Skip current user in main list since we show them at top
              if (isCurrentUser) return null;

              return (
                <tr
                  key={user.id}
                  className={`border-b transition-colors hover:bg-opacity-100 ${
                    user.rank <= 3 ? 'bg-black' : ''
                  } ${shouldBlur ? 'blur-sm opacity-50' : ''}`}
                  style={{borderBottomColor: 'rgba(38, 38, 38, 1)'}}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(140, 174, 245, 0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = user.rank <= 3 ? 'black' : 'transparent';
                  }}
                >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    {user.rank <= 3 && (
                      <div className={`w-2 h-2 rounded-full ${
                        user.rank === 1 ? 'bg-yellow-400' :
                        user.rank === 2 ? 'bg-gray-400' :
                        'bg-orange-500'
                      }`}></div>
                    )}
                    <span className={`text-sm font-medium ${
                      user.rank === 1 ? 'text-yellow-400' :
                      user.rank === 2 ? 'text-gray-300' :
                      user.rank === 3 ? 'text-orange-500' : ''
                    }`} style={{
                      color: user.rank > 3 ? 'rgba(141, 141, 141, 1)' : undefined
                    }}>
                      {String(user.rank).padStart(3, '0')}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <a
                    href={`https://x.com/${user.twitterHandle.slice(1)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white hover:text-gray-300 transition-colors flex items-center gap-2 group"
                  >
                    <span className="text-sm">{user.twitterHandle}</span>
                    <ExternalLink className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
                  </a>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-sm tabular-nums text-white">
                    {formatNumber(user.twitterFollowers)}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-sm tabular-nums text-white">
                    +{user.referralCount}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-sm tabular-nums text-white">
                    +{user.indirectReferralCount}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-sm font-medium tabular-nums" style={{color: 'rgb(92, 255, 59)'}}>
                    {formatNumber(Math.round(user.totalScore * 100))}
                  </span>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        {/* Mobile Card View */}
        <div className="sm:hidden px-4 pb-6">
          {/* Current User Card */}
          {authState.user && userRank && (
            <div
              className="mb-4 p-4 border-2 transition-colors"
              style={{
                borderColor: '#2d70fa',
                backgroundColor: 'rgba(45, 112, 250, 0.1)'
              }}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-blue-400">
                    #{String(userRank).padStart(3, '0')}
                  </span>
                </div>
                <span className="text-2xl font-bold tabular-nums" style={{color: 'rgb(92, 255, 59)'}}>
                  {formatNumber(Math.round((leaderboardData.find(u => u.twitterHandle === authState.user?.twitterHandle)?.totalScore || 0) * 100))}
                </span>
              </div>
              <div className="text-base font-medium text-blue-400 mb-3">{authState.user.twitterHandle}</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div style={{color: 'rgba(111, 111, 111, 1)'}} className="uppercase mb-1">Followers</div>
                  <div className="text-white tabular-nums">{formatNumber(authState.user.twitterFollowers)}</div>
                </div>
                <div>
                  <div style={{color: 'rgba(111, 111, 111, 1)'}} className="uppercase mb-1">Refs</div>
                  <div className="text-white tabular-nums">+{leaderboardData.find(u => u.twitterHandle === authState.user?.twitterHandle)?.referralCount || 0}</div>
                </div>
                <div>
                  <div style={{color: 'rgba(111, 111, 111, 1)'}} className="uppercase mb-1">Indirect</div>
                  <div className="text-white tabular-nums">+{leaderboardData.find(u => u.twitterHandle === authState.user?.twitterHandle)?.indirectReferralCount || 0}</div>
                </div>
              </div>
            </div>
          )}

          {/* Leaderboard Cards */}
          {leaderboardData.map((user) => {
            const isCurrentUser = authState.user && user.twitterHandle === authState.user.twitterHandle;
            const shouldBlur = user.rank > 10;

            // Skip current user in main list since we show them at top
            if (isCurrentUser) return null;

            return (
              <div
                key={user.id}
                className={`mb-3 p-4 border transition-colors ${shouldBlur ? 'blur-sm opacity-50' : ''}`}
                style={{
                  borderColor: 'rgba(38, 38, 38, 1)',
                  backgroundColor: user.rank <= 3 ? 'rgba(20, 20, 20, 1)' : 'transparent'
                }}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    {user.rank <= 3 && (
                      <div className={`w-2 h-2 rounded-full ${
                        user.rank === 1 ? 'bg-yellow-400' :
                        user.rank === 2 ? 'bg-gray-400' :
                        'bg-orange-500'
                      }`}></div>
                    )}
                    <span className={`text-lg font-bold ${
                      user.rank === 1 ? 'text-yellow-400' :
                      user.rank === 2 ? 'text-gray-300' :
                      user.rank === 3 ? 'text-orange-500' : ''
                    }`} style={{
                      color: user.rank > 3 ? 'rgba(141, 141, 141, 1)' : undefined
                    }}>
                      #{String(user.rank).padStart(3, '0')}
                    </span>
                  </div>
                  <span className="text-2xl font-bold tabular-nums" style={{color: 'rgb(92, 255, 59)'}}>
                    {formatNumber(Math.round(user.totalScore * 100))}
                  </span>
                </div>
                <a
                  href={`https://x.com/${user.twitterHandle.slice(1)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white hover:text-gray-300 transition-colors flex items-center gap-2 group mb-3"
                >
                  <span className="text-base font-medium">{user.twitterHandle}</span>
                  <ExternalLink className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
                </a>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div style={{color: 'rgba(111, 111, 111, 1)'}} className="uppercase mb-1">Followers</div>
                    <div className="text-white tabular-nums">{formatNumber(user.twitterFollowers)}</div>
                  </div>
                  <div>
                    <div style={{color: 'rgba(111, 111, 111, 1)'}} className="uppercase mb-1">Refs</div>
                    <div className="text-white tabular-nums">+{user.referralCount}</div>
                  </div>
                  <div>
                    <div style={{color: 'rgba(111, 111, 111, 1)'}} className="uppercase mb-1">Indirect</div>
                    <div className="text-white tabular-nums">+{user.indirectReferralCount}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  )
}
