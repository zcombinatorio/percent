export interface LeaderboardUser {
  id: string
  rank: number
  twitterHandle: string
  twitterFollowers: number
  referralCount: number
  indirectReferralCount: number
  totalScore: number
  tokenScore?: number
  totalTokens?: number
  joinedAt: string
  avatar?: string
}

export interface AuthState {
  isAuthenticated: boolean
  user?: {
    id: string
    twitterHandle: string
    twitterFollowers: number
    referralCode: string
    referralLinks: string[]
  }
}
