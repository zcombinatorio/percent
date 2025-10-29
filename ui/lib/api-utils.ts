/**
 * Utility function to append moderatorId to API URLs
 * Handles existing query parameters properly
 */
export function withModeratorId(url: string): string {
  const moderatorId = process.env.NEXT_PUBLIC_MODERATOR_ID;

  if (!moderatorId) {
    throw new Error('NEXT_PUBLIC_MODERATOR_ID environment variable is not set');
  }

  // Check if URL already has query parameters
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}moderatorId=${moderatorId}`;
}

/**
 * Helper to build URL with moderator ID and other params
 */
export function buildApiUrl(baseUrl: string, path: string, params?: Record<string, any>): string {
  let url = `${baseUrl}${path}`;

  // Add moderatorId first
  const moderatorId = process.env.NEXT_PUBLIC_MODERATOR_ID;
  if (!moderatorId) {
    throw new Error('NEXT_PUBLIC_MODERATOR_ID environment variable is not set');
  }

  const allParams = { moderatorId, ...params };

  // Build query string
  const queryParams = Object.entries(allParams)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');

  if (queryParams) {
    url += `?${queryParams}`;
  }

  return url;
}