// retry.js — wraps an async fn with retries
async function withRetry(fn, { retries = 3, delayMs = 100 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (err.status >= 400 && err.status < 500) throw err; // client errors are not retried
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
module.exports = { withRetry };
