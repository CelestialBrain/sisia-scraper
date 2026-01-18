/**
 * Delay utilities for human-like behavior simulation
 */

/**
 * Sleep for a random duration between min and max milliseconds
 */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Get delay values from environment or use defaults
 */
export function getDelayConfig() {
  return {
    minDelay: parseInt(process.env.MIN_DELAY || "3000"),
    maxDelay: parseInt(process.env.MAX_DELAY || "8000"),
    readingPauseMin: parseInt(process.env.READING_PAUSE_MIN || "10000"),
    readingPauseMax: parseInt(process.env.READING_PAUSE_MAX || "30000"),
  };
}

/**
 * Standard action delay (between clicks, scrolls, etc.)
 */
export async function actionDelay(): Promise<void> {
  const config = getDelayConfig();
  await randomDelay(config.minDelay, config.maxDelay);
}

/**
 * Longer delay to simulate reading content
 */
export async function readingPause(): Promise<void> {
  const config = getDelayConfig();
  await randomDelay(config.readingPauseMin, config.readingPauseMax);
}

/**
 * Very short delay for micro-interactions
 */
export async function microDelay(): Promise<void> {
  await randomDelay(100, 500);
}

/**
 * Random chance to trigger a reading pause (for more natural behavior)
 * @param probability - Chance to pause (0.0 to 1.0)
 */
export async function maybeReadingPause(probability: number = 0.15): Promise<void> {
  if (Math.random() < probability) {
    await readingPause();
  }
}
