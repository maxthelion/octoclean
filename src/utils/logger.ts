import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let currentLevel: LogLevel = 'info';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => {
    if (shouldLog('debug')) console.error(chalk.gray(`[debug] ${msg}`), ...args);
  },
  info: (msg: string, ...args: unknown[]) => {
    if (shouldLog('info')) console.log(msg, ...args);
  },
  warn: (msg: string, ...args: unknown[]) => {
    if (shouldLog('warn')) console.warn(chalk.yellow(`⚠  ${msg}`), ...args);
  },
  error: (msg: string, ...args: unknown[]) => {
    if (shouldLog('error')) console.error(chalk.red(`✖  ${msg}`), ...args);
  },
  success: (msg: string, ...args: unknown[]) => {
    if (shouldLog('info')) console.log(chalk.green(`✔  ${msg}`), ...args);
  },
  step: (msg: string, ...args: unknown[]) => {
    if (shouldLog('info')) console.log(chalk.cyan(`→  ${msg}`), ...args);
  },
  dim: (msg: string, ...args: unknown[]) => {
    if (shouldLog('info')) console.log(chalk.dim(msg), ...args);
  },
};
