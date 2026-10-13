import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetStop } from "../commands/contribute.js";

test("budgetStop: a corrupt contribution row (spent not finite) blocks with its own message", () => {
  const budget = { amount: 25, currency: "USD" };
  assert.equal(budgetStop(3, 5, budget), null);
  const over = budgetStop(20, 10, budget);
  assert.ok(over && /exceeds monthly_budget_max/.test(over.join("\n")));
  const corrupt = budgetStop(Infinity, 1, budget);
  assert.ok(corrupt);
  const text = corrupt.join("\n");
  assert.match(text, /POLICY STOP/);
  assert.match(text, /corrupt contribution/i);
  assert.doesNotMatch(text, /Infinity/);
});
