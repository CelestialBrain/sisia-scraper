/**
 * API Usage Tracking
 * 
 * Tracks request and token usage against configurable limits.
 */

export interface UsageStats {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerDay: number;
  lastMinuteReset: number;
  lastHourReset: number;
  lastDayReset: number;
}

// Configurable limits (update from Google Cloud Console)
export const API_LIMITS = {
  requestsPerMinute: 60,    // Default free tier
  requestsPerDay: 1500,     // Default free tier
  tokensPerMinute: 32000,   // ~32k tokens/min
  tokensPerDay: 1500000,    // ~1.5M tokens/day
};

const usageStats: UsageStats = {
  requestsPerMinute: 0,
  requestsPerHour: 0,
  requestsPerDay: 0,
  tokensPerMinute: 0,
  tokensPerDay: 0,
  lastMinuteReset: Date.now(),
  lastHourReset: Date.now(),
  lastDayReset: Date.now(),
};

export function trackUsage(tokensUsed: number = 0): void {
  const now = Date.now();
  
  // Reset counters if time elapsed
  if (now - usageStats.lastMinuteReset > 60000) {
    usageStats.requestsPerMinute = 0;
    usageStats.tokensPerMinute = 0;
    usageStats.lastMinuteReset = now;
  }
  if (now - usageStats.lastHourReset > 3600000) {
    usageStats.requestsPerHour = 0;
    usageStats.lastHourReset = now;
  }
  if (now - usageStats.lastDayReset > 86400000) {
    usageStats.requestsPerDay = 0;
    usageStats.tokensPerDay = 0;
    usageStats.lastDayReset = now;
  }
  
  // Increment counters
  usageStats.requestsPerMinute++;
  usageStats.requestsPerHour++;
  usageStats.requestsPerDay++;
  usageStats.tokensPerMinute += tokensUsed;
  usageStats.tokensPerDay += tokensUsed;
}

export function getUsageInfo() {
  // Refresh counters first
  trackUsage(0);
  usageStats.requestsPerMinute--; // Don't count this call
  
  return {
    current: {
      requestsPerMinute: usageStats.requestsPerMinute,
      requestsPerHour: usageStats.requestsPerHour,
      requestsPerDay: usageStats.requestsPerDay,
      tokensPerMinute: usageStats.tokensPerMinute,
      tokensPerDay: usageStats.tokensPerDay,
    },
    limits: API_LIMITS,
    percentUsed: {
      requestsPerMinute: Math.round((usageStats.requestsPerMinute / API_LIMITS.requestsPerMinute) * 100),
      requestsPerDay: Math.round((usageStats.requestsPerDay / API_LIMITS.requestsPerDay) * 100),
      tokensPerMinute: Math.round((usageStats.tokensPerMinute / API_LIMITS.tokensPerMinute) * 100),
      tokensPerDay: Math.round((usageStats.tokensPerDay / API_LIMITS.tokensPerDay) * 100),
    },
    resetIn: {
      minute: Math.max(0, 60 - Math.floor((Date.now() - usageStats.lastMinuteReset) / 1000)),
      hour: Math.max(0, 3600 - Math.floor((Date.now() - usageStats.lastHourReset) / 1000)),
      day: Math.max(0, 86400 - Math.floor((Date.now() - usageStats.lastDayReset) / 1000)),
    },
  };
}
