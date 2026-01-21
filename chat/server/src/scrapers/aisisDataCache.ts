/**
 * AISIS Data Cache
 * 
 * Caches user's personal AISIS data after first access.
 * When any personal tool is called, prefetches ALL user data concurrently.
 * 
 * TTL: 30 minutes (matches session TTL)
 */

const USER_DATA_CACHE = new Map<string, {
  schedule: any;
  grades: any;
  ips: any;
  holds: any;
  enrolled: any;
  fetchedAt: number;
  fetching: Promise<void> | null;
}>();

const DATA_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface AISISUserData {
  schedule: any;
  grades: any;
  ips: any;
  holds: any;
  enrolled: any;
}

/**
 * Get cached user data or trigger concurrent fetch
 */
export async function getOrFetchUserData(
  userId: string,
  fetchFunctions: {
    schedule: () => Promise<any>;
    grades: () => Promise<any>;
    ips: () => Promise<any>;
    holds: () => Promise<any>;
    enrolled: () => Promise<any>;
  }
): Promise<AISISUserData> {
  const cached = USER_DATA_CACHE.get(userId);
  
  // Return cached data if still valid
  if (cached && cached.fetchedAt + DATA_TTL_MS > Date.now() && !cached.fetching) {
    console.log('[AISIS Cache] Using cached data for user:', userId.substring(0, 8) + '...');
    return {
      schedule: cached.schedule,
      grades: cached.grades,
      ips: cached.ips,
      holds: cached.holds,
      enrolled: cached.enrolled,
    };
  }
  
  // If already fetching, wait for it
  if (cached?.fetching) {
    console.log('[AISIS Cache] Waiting for concurrent fetch...');
    await cached.fetching;
    const result = USER_DATA_CACHE.get(userId)!;
    return {
      schedule: result.schedule,
      grades: result.grades,
      ips: result.ips,
      holds: result.holds,
      enrolled: result.enrolled,
    };
  }
  
  // Start concurrent fetch
  console.log('[AISIS Cache] Starting concurrent fetch of all user data...');
  const startTime = Date.now();
  
  const entry = {
    schedule: null as any,
    grades: null as any,
    ips: null as any,
    holds: null as any,
    enrolled: null as any,
    fetchedAt: 0,
    fetching: null as Promise<void> | null,
  };
  
  // Create the concurrent fetch promise
  entry.fetching = (async () => {
    try {
      // Fetch all data concurrently
      const [schedule, grades, ips, holds, enrolled] = await Promise.allSettled([
        fetchFunctions.schedule().catch(e => ({ error: e.message })),
        fetchFunctions.grades().catch(e => ({ error: e.message })),
        fetchFunctions.ips().catch(e => ({ error: e.message })),
        fetchFunctions.holds().catch(e => ({ error: e.message })),
        fetchFunctions.enrolled().catch(e => ({ error: e.message })),
      ]);
      
      entry.schedule = schedule.status === 'fulfilled' ? schedule.value : { error: 'fetch failed' };
      entry.grades = grades.status === 'fulfilled' ? grades.value : { error: 'fetch failed' };
      entry.ips = ips.status === 'fulfilled' ? ips.value : { error: 'fetch failed' };
      entry.holds = holds.status === 'fulfilled' ? holds.value : { error: 'fetch failed' };
      entry.enrolled = enrolled.status === 'fulfilled' ? enrolled.value : { error: 'fetch failed' };
      entry.fetchedAt = Date.now();
      entry.fetching = null;
      
      const duration = Date.now() - startTime;
      console.log(`[AISIS Cache] Concurrent fetch completed in ${duration}ms`);
    } catch (error) {
      console.error('[AISIS Cache] Concurrent fetch failed:', error);
      entry.fetching = null;
      throw error;
    }
  })();
  
  USER_DATA_CACHE.set(userId, entry);
  
  // Wait for fetch to complete
  await entry.fetching;
  
  return {
    schedule: entry.schedule,
    grades: entry.grades,
    ips: entry.ips,
    holds: entry.holds,
    enrolled: entry.enrolled,
  };
}

/**
 * Get specific cached data type (returns null if not cached)
 */
export function getCachedData(userId: string, type: keyof AISISUserData): any | null {
  const cached = USER_DATA_CACHE.get(userId);
  if (!cached || cached.fetchedAt + DATA_TTL_MS < Date.now()) {
    return null;
  }
  return cached[type];
}

/**
 * Update specific cached data
 */
export function updateCachedData(userId: string, type: keyof AISISUserData, data: any): void {
  const cached = USER_DATA_CACHE.get(userId);
  if (cached) {
    cached[type] = data;
    cached.fetchedAt = Date.now();
  }
}

/**
 * Invalidate user's cached data
 */
export function invalidateUserCache(userId: string): void {
  USER_DATA_CACHE.delete(userId);
  console.log('[AISIS Cache] Invalidated cache for user:', userId.substring(0, 8) + '...');
}

/**
 * Get cache stats
 */
export function getCacheStats(): { 
  users: number; 
  entries: Array<{ userId: string; age: number; isFetching: boolean }> 
} {
  const now = Date.now();
  return {
    users: USER_DATA_CACHE.size,
    entries: Array.from(USER_DATA_CACHE.entries()).map(([userId, data]) => ({
      userId: userId.substring(0, 8) + '...',
      age: Math.round((now - data.fetchedAt) / 1000),
      isFetching: !!data.fetching,
    })),
  };
}
