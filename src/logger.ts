/**
 * SISIA Logger - Enhanced logging system for the scraper
 * Provides structured logging with levels, colors, and file output
 */

import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  data?: any;
}

// ANSI colors for terminal output
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: COLORS.dim,
  [LogLevel.INFO]: COLORS.green,
  [LogLevel.WARN]: COLORS.yellow,
  [LogLevel.ERROR]: COLORS.red,
};

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

class Logger {
  private minLevel: LogLevel;
  private logDir: string;
  private logFile: string | null = null;
  private logBuffer: LogEntry[] = [];

  constructor() {
    this.minLevel = process.env.DEBUG_SCRAPER === 'true' ? LogLevel.DEBUG : LogLevel.INFO;
    this.logDir = path.join(process.cwd(), 'logs');
    
    // Create logs directory
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Start a new log session with timestamped file
   */
  startSession(name: string = 'scrape') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = path.join(this.logDir, `${name}-${timestamp}.log`);
    this.logBuffer = [];
    this.info('Logger', `Session started: ${this.logFile}`);
  }

  private formatTime(): string {
    return new Date().toISOString().substring(11, 23); // HH:MM:SS.mmm
  }

  private log(level: LogLevel, component: string, message: string, data?: any) {
    if (level < this.minLevel) return;

    const timestamp = this.formatTime();
    const levelName = LEVEL_NAMES[level];
    const color = LEVEL_COLORS[level];

    // Console output with colors
    const prefix = `${COLORS.dim}${timestamp}${COLORS.reset} ${color}${levelName.padEnd(5)}${COLORS.reset}`;
    const componentStr = `${COLORS.cyan}[${component}]${COLORS.reset}`;
    
    console.log(`${prefix} ${componentStr} ${message}`);
    
    if (data && level >= LogLevel.DEBUG) {
      console.log(`${COLORS.dim}  └─ ${JSON.stringify(data, null, 2).split('\n').join('\n     ')}${COLORS.reset}`);
    }

    // Buffer for file output
    const entry: LogEntry = { timestamp, level: levelName, component, message, data };
    this.logBuffer.push(entry);
  }

  debug(component: string, message: string, data?: any) {
    this.log(LogLevel.DEBUG, component, message, data);
  }

  info(component: string, message: string, data?: any) {
    this.log(LogLevel.INFO, component, message, data);
  }

  warn(component: string, message: string, data?: any) {
    this.log(LogLevel.WARN, component, message, data);
  }

  error(component: string, message: string, data?: any) {
    this.log(LogLevel.ERROR, component, message, data);
  }

  /**
   * Log progress for batch operations
   */
  progress(component: string, current: number, total: number, item: string, extra?: string) {
    const pct = Math.round((current / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    const extraStr = extra ? ` ${COLORS.dim}(${extra})${COLORS.reset}` : '';
    console.log(`${COLORS.dim}${this.formatTime()}${COLORS.reset} ${COLORS.blue}${bar}${COLORS.reset} ${current}/${total} ${item}${extraStr}`);
  }

  /**
   * Log a summary table
   */
  summary(title: string, data: Record<string, number | string>) {
    console.log(`\n${COLORS.cyan}╭${'─'.repeat(48)}╮${COLORS.reset}`);
    console.log(`${COLORS.cyan}│${COLORS.reset} ${COLORS.green}${title.padEnd(47)}${COLORS.reset}${COLORS.cyan}│${COLORS.reset}`);
    console.log(`${COLORS.cyan}├${'─'.repeat(48)}┤${COLORS.reset}`);
    
    for (const [key, value] of Object.entries(data)) {
      const valueStr = typeof value === 'number' ? value.toLocaleString() : value;
      console.log(`${COLORS.cyan}│${COLORS.reset}  ${key.padEnd(25)} ${String(valueStr).padStart(20)} ${COLORS.cyan}│${COLORS.reset}`);
    }
    
    console.log(`${COLORS.cyan}╰${'─'.repeat(48)}╯${COLORS.reset}\n`);
  }

  /**
   * Save raw HTML for debugging
   */
  saveRawHTML(reason: string, dept: string, term: string, html: string): string {
    const timestamp = Date.now();
    const filename = `raw-${reason}-${term}-${dept}-${timestamp}.html`;
    const filepath = path.join(this.logDir, filename);
    fs.writeFileSync(filepath, html);
    this.warn('Logger', `Saved raw HTML: ${filename}`);
    return filepath;
  }

  /**
   * Flush log buffer to file
   */
  flush() {
    if (this.logFile && this.logBuffer.length > 0) {
      const content = this.logBuffer.map(entry => 
        `${entry.timestamp} [${entry.level}] [${entry.component}] ${entry.message}${entry.data ? ' ' + JSON.stringify(entry.data) : ''}`
      ).join('\n');
      fs.appendFileSync(this.logFile, content + '\n');
      this.logBuffer = [];
    }
  }
}

// Singleton instance
export const logger = new Logger();
