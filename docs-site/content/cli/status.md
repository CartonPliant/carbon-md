# carbon-md status

Your footprint and your position against the policy.

```bash
npx carbon-md status
```

## Output

```
carbon.md — my-project

  This month     412 g CO2e     (220 g – 780 g)     128 calls
  All time       1.51 kg CO2e   (810 g – 2.9 kg)    873,412 tokens

  By model
    claude-sonnet-4        980 g    large
    gpt-5.5                420 g    frontier
    kimi-k2.7-code         110 g    medium (guessed)

  Policy         110% contribution · removal-weighted
  Target         0.0017 tCO2e
  Contributed    0.0000 tCO2e
  Outstanding    0.0017 tCO2e   (~$0.10 at removal-weighted prices)

  Next: npx carbon-md contribute
```

## Reading it

- **Ranges everywhere.** The central figure is a point estimate inside a wide honest band. See [Methodology](/methodology/).
- **`(guessed)`** means the model string didn't match a known class — the estimate still counts, with a wider range.
- **Target** = all-time estimated emissions × `contribution_target`.
- **Outstanding** = target − already contributed. The dollar figure is an *assumption* from your portfolio's price band, not a quote.
- **Calls vs tokens** — calls count ledger events; tokens are input + output (cache reads excluded).

## Notes

- `status` is read-only. It never writes to the ledger or contacts the network.
- If it reports nothing, you haven't captured usage yet — see [`sync`](/cli/sync/) or [`ingest`](/cli/ingest/).
- Monthly figures follow calendar months in UTC, like the ledger timestamps; contributions are prepared monthly by default.
