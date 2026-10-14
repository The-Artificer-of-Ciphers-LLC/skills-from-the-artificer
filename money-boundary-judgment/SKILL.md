---
name: money-boundary-judgment
description: How to cross an API that forces Double (framework parameters, chart plot values, any Double-only library) without breaking a "Decimal for money" rule. Use when a lint flags decimal-for-money, or when writing code that converts between Double and Decimal for monetary values.
---

# money-boundary-judgment

Policy assumed: all monetary values are `Decimal`. Some frameworks only accept `Double`. The rule is kept by converting exactly once, at the edge, in the right direction.

## 1. Is Double actually forced?

Check the API's accepted types in the framework's current documentation before assuming. If `Decimal` works, use it and stop.

## 2. Which direction?

| Direction | Where it happens | Rule |
| --- | --- | --- |
| Decimal -> Double | Display-only sinks (chart plot values, progress) | Convert at the last line before the framework (`NSDecimalNumber(decimal:).doubleValue`). The Double never flows back into money math. |
| Double -> Decimal | Inputs (framework parameters, parsed numbers) | Do not use `Decimal(double)`: it carries binary error (e.g. `0.1` becomes `0.1000000000000000055...`). Go through a string or round to currency minor units, then use only the Decimal. |

## 3. Is there math on the Double side?

Averages, sums, percentages of money are computed in Decimal first and converted after. A Double on a money-named variable that feeds arithmetic is not a boundary; it is the bug.

## 4. Mark it

Put `// money-boundary: <which framework, which direction>` on the declaration line, for example `// money-boundary: charts plot value, Decimal -> Double`. This is an optional convention: any linter or grep-based check for Double-typed money variables can look for the marker and accept the line, and the reason stays on record.

## 5. Test the conversion

For Double -> Decimal inputs: a test at `limit-1`, `limit`, `limit+1` of the minor-unit precision (e.g. 19.989, 19.99, 19.991), asserting the exact Decimal.
