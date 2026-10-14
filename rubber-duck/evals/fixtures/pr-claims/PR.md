# PR #212: add withRetry helper
Claims:
1. "Retries the call up to 3 times after the first failure (4 calls total)."
2. "Backs off exponentially between attempts."
3. "4xx errors are never retried, 5xx and network errors are."
4. "The final error thrown is the last error seen."
