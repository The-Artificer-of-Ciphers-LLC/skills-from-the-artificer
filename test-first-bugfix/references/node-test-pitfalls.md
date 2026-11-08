# Node / TypeScript test pitfalls

Companion to the `test-first-bugfix` skill. Everything here was learned from real CI failures in a
Node `node:test` + TypeScript project; the commands and config names are that project's, so adapt
them. Read before pushing test changes in such a repo; ignore for other stacks.

## Contents

- [Pre-Push Verification (CI/CD Prevention)](#pre-push-verification-cicd-prevention)
- [PR Freshness (Preventing Stale Base Failures)](#pr-freshness-preventing-stale-base-failures)

## Pre-Push Verification (CI/CD Prevention)

Before pushing test changes, run these checks locally. These catch the exact failures that have repeatedly broken CI:

### Required Local Checks

```bash
# 1. TypeScript compilation — use BOTH tsconfigs
npx tsc --noEmit                                    # root (src/tests/)
npx tsc --noEmit --project tsconfig.extensions.json  # extensions (gsd/tests/)

# 2. Node type-stripping syntax check (catches what tsc misses)
for f in $(git diff --name-only HEAD~ -- '*.test.ts'); do
  node --experimental-strip-types -e "import('./$f')" 2>&1 | grep -q 'SyntaxError' && echo "FAIL: $f"
done

# 3. Run affected tests
npm run test:unit -- --test-name-pattern "pattern"
```

### Known Pitfalls (from real CI failures)

**1. `t.after()` requires `(t)` parameter**
```typescript
// WRONG — ReferenceError: t is not defined
test("name", async () => {
  t.after(() => cleanup());  // ❌ no t in scope
});

// RIGHT
test("name", async (t) => {
  t.after(() => cleanup());  // ✅ t from parameter
});
```

**2. `t.after()` with try/catch needs block braces**
```typescript
// WRONG — arrow function can't contain statements without braces
t.after(() => try { rmSync(tmp) } catch { });  // ❌ SyntaxError

// RIGHT
t.after(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { } });  // ✅
```

**3. Helper functions CANNOT use `t.after()` — keep try/finally**
```typescript
// WRONG — helpers don't have test context
function withEnv(env, fn) {
  t.after(() => restore());  // ❌ t not in scope
}

// RIGHT — helpers keep try/finally
function withEnv(env, fn) {
  const original = { ...process.env };
  try { fn(); } finally { Object.assign(process.env, original); }  // ✅
}
```

**4. Double braces from refactoring**
```typescript
// WRONG — extra brace from try removal
test("name", (t) => {{  // ❌ double brace
  // code
}});

// RIGHT
test("name", (t) => {  // ✅ single brace
  // code
});
```

**5. Orphaned catch/finally without try**
```typescript
// WRONG — try was removed but catch left behind
const result = doSomething();
} catch {  // ❌ orphaned catch
  // handle
}
```

**6. Two tsconfigs catch different errors**
- Root `tsconfig.json` **excludes** `src/resources/` — so `npx tsc --noEmit` won't catch errors in extension test files
- CI uses `tsconfig.extensions.json` which **includes** `src/resources/`
- **Always check both** before pushing

**7. Missing semicolons in refactored code**
When moving code between blocks (e.g., extracting from try/finally into t.after), ensure statement terminators are preserved. Node's ASI (Automatic Semicolon Insertion) doesn't always save you — especially before `(` or `[` on the next line.

### When to use `t.after()` vs `try/finally`

| Scenario | Use | Reason |
|----------|-----|--------|
| Test body cleanup (temp dirs, env vars) | `t.after()` | Cleaner, runs after test regardless |
| Helper function cleanup | `try/finally` | No access to test context `t` |
| Cleanup that assertions depend on | `try/finally` | `t.after()` runs AFTER assertions |
| Multi-step cleanup with ordering | `try/finally` | Explicit ordering guaranteed |

## PR Freshness (Preventing Stale Base Failures)

The #1 cause of CI failures (45% in our analysis) is **stale base branches**. When a PR sits open for more than a few hours on an active repo, main evolves and the PR's tests may fail against the new code.

### Before Pushing Any PR

```bash
# Always rebase onto latest main before pushing
git fetch origin main
git rebase origin/main
# Resolve any conflicts, then verify
npx tsc --noEmit
npx tsc --noEmit --project tsconfig.extensions.json  # if touching extensions
```

### Before Fixing a Failing PR

```bash
# Check if main has evolved since the PR was created
git log --oneline origin/main..HEAD | wc -l  # commits behind
git log --oneline HEAD..origin/main | wc -l  # commits ahead on main
# If main is ahead, rebase first — the failure may resolve itself
```

### Template Literal Indentation (Test-Specific)

When test fixtures use template literals inside `describe`/`test` blocks, every line inherits the block's indentation. Regex anchors like `^###` fail because the content starts with spaces.

```typescript
// WRONG — 2-space indent breaks ^### regex
describe("parser", () => {
  test("parses heading", () => {
    const content = `
### R001 --- Title
- Description here
`;  // ❌ Every line has leading spaces from indentation
  });
});

// RIGHT — array.join preserves exact whitespace
test("parses heading", () => {
  const content = [
    "### R001 --- Title",
    "- Description here",
  ].join("\n");  // ✅ No unintended indentation
});
```

### Top-Level Await Race (Test-Specific)

`node:test` serializes registered `test()` calls, but top-level `await` runs during module evaluation — **before test registration completes**. If a top-level block and a `test()` both use a shared singleton (like a DB connection), they race.

```typescript
// WRONG — top-level block runs concurrently with test() calls
console.log("── my test ──");
{
  const db = openDatabase(path);  // Races with test() DB access
  await doSomething(db);
  closeDatabase();
}

// RIGHT — wrap in test() for serialized execution
test("my test", async () => {
  const db = openDatabase(path);
  await doSomething(db);
  closeDatabase();
});
```
