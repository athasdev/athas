/**
 * Editor logging utility
 * Provides structured logging with levels and can be disabled in production
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggerConfig {
  enabled: boolean;
  minLevel: LogLevel;
  prefix: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class EditorLogger {
  private config: LoggerConfig = {
    enabled: import.meta.env.DEV, // Only enabled in development
    minLevel: "debug",
    prefix: "[Editor]",
  };

  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatMessage(component: string, message: string): string {
    return `${this.config.prefix}${component ? `[${component}]` : ""} ${message}`;
  }

  debug(component: string, message: string, ...args: unknown[]): void {
    if (this.shouldLog("debug")) {
      console.log(this.formatMessage(component, message), ...args);
    }
  }

  info(component: string, message: string, ...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage(component, message), ...args);
    }
  }

  warn(component: string, message: string, ...args: unknown[]): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage(component, message), ...args);
    }
  }

  error(component: string, message: string, ...args: unknown[]): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage(component, message), ...args);
    }
  }
}

export const logger = new EditorLogger();
