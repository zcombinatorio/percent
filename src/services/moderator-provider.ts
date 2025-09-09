import { Moderator } from '../../app/moderator';
import ModeratorService from './moderator.service';
import TestModeratorService from '../test/test-moderator.service';

/**
 * Provides the appropriate moderator instance based on environment
 */
export function getModerator(): Moderator {
  // Check if test moderator is initialized (happens in test server)
  try {
    return TestModeratorService.getInstance();
  } catch {
    // Fall back to production moderator
    return ModeratorService.getInstance();
  }
}