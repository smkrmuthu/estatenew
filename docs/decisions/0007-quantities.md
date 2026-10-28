# ADR-0007: Quantities

- Status: Accepted, 28 October 2026

Weights are integer grams in storage and in arithmetic. Input is parsed from a decimal string with at most 3 decimal places of kilograms (no floating point). Shown as kilograms with 1 to 3 decimals. Daily log readings are stored as an integer plus the kind's decimal scale. Percentages, when needed, are integer hundredths.
