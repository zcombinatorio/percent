/**
 * Utility function to append moderatorId to API URLs
 * Handles existing query parameters properly
 */
export function withModeratorId(url: string, moderatorId?: number | string): string {
  const id = moderatorId?.toString() || process.env.NEXT_PUBLIC_MODERATOR_ID;

  if (!id) {
    throw new Error('NEXT_PUBLIC_MODERATOR_ID environment variable is not set');
  }

  // Check if URL already has query parameters
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}moderatorId=${id}`;
}

/**
 * Helper to build URL with moderator ID and other params
 */
export function buildApiUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, any>,
  moderatorId?: number | string
): string {
  let url = `${baseUrl}${path}`;

  // Use provided moderatorId or fall back to env var
  const id = moderatorId?.toString() || process.env.NEXT_PUBLIC_MODERATOR_ID;
  const allParams = id !== undefined
    ? { moderatorId: id, ...params }
    : { ...params };

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