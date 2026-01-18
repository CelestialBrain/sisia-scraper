/**
 * Logging utilities with color output
 */

import chalk from "chalk";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

let currentLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function timestamp(): string {
  return new Date().toISOString().substring(11, 19);
}

export function debug(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.DEBUG) {
    console.log(chalk.gray(`[${timestamp()}] [DEBUG]`), message, ...args);
  }
}

export function info(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.INFO) {
    console.log(chalk.blue(`[${timestamp()}] [INFO]`), message, ...args);
  }
}

export function success(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.INFO) {
    console.log(chalk.green(`[${timestamp()}] [OK]`), message, ...args);
  }
}

export function warn(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.WARN) {
    console.log(chalk.yellow(`[${timestamp()}] [WARN]`), message, ...args);
  }
}

export function error(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.ERROR) {
    console.log(chalk.red(`[${timestamp()}] [ERROR]`), message, ...args);
  }
}

export function scrape(message: string, ...args: unknown[]): void {
  console.log(chalk.magenta(`[${timestamp()}] [SCRAPE]`), message, ...args);
}

export function capture(message: string, ...args: unknown[]): void {
  console.log(chalk.cyan(`[${timestamp()}] [CAPTURE]`), message, ...args);
}

export function match(message: string, ...args: unknown[]): void {
  console.log(chalk.yellow(`[${timestamp()}] [MATCH]`), message, ...args);
}
