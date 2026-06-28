export interface RetryOptions {
  retries: number;
  retryable: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number) => void;
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.retries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt > opts.retries || !opts.retryable(err)) throw err;
      opts.onRetry?.(err, attempt);
    }
  }
  throw lastErr;
}
