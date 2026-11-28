"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateFare, validateDiscountPercentage } = require("../src/validation/fare");

const invalidFareError = {
  statusCode: 400,
  code: "INVALID_FARE",
  message: "Enter a valid fare.",
};

test("validateFare accepts a positive decimal and zero without changing the value", () => {
  assert.strictEqual(validateFare(1.25), 1.25);
  assert.strictEqual(validateFare(0), 0);
});

test("validateFare rejects negative fares with the required user message", () => {
  for (const value of [-1, -0.01]) {
    assert.throws(() => validateFare(value), {
      statusCode: 400,
      code: "NEGATIVE_FARE",
      message: "Fare can't be negative",
    });
  }
});

test("validateFare rejects a missing value", () => {
  assert.throws(() => validateFare(), invalidFareError);
});

test("validateFare rejects non-numeric types and strings without coercing them", () => {
  const invalidValues = [null, "", " \t", "1.25", "abc", true, false, [], [1.25], {}];

  for (const value of invalidValues) {
    assert.throws(() => validateFare(value), invalidFareError, `Rejected input: ${JSON.stringify(value)}`);
  }
});

test("validateFare rejects non-finite numbers", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => validateFare(value), invalidFareError, `Rejected input: ${value}`);
  }
});

test("validateDiscountPercentage accepts both endpoints and decimal values unchanged", () => {
  for (const value of [0, 31.82, 35.125, 100]) {
    assert.strictEqual(validateDiscountPercentage(value), value);
  }
});

test("the upper bound applies to discount percentages only", () => {
  assert.throws(() => validateDiscountPercentage(100.01), {
    statusCode: 400,
    code: "INVALID_FARE",
    message: "Discount must be between 0 and 100.",
  });
  assert.strictEqual(validateFare(100.01), 100.01);
});

test("validateDiscountPercentage preserves the negative fare error", () => {
  assert.throws(() => validateDiscountPercentage(-0.01), {
    statusCode: 400,
    code: "NEGATIVE_FARE",
    message: "Fare can't be negative",
  });
});

test("validateDiscountPercentage rejects missing, invalid, and non-finite values", () => {
  const invalidValues = [undefined, null, "", " \t", "31.82", "abc", true, false, [], {}, NaN, Infinity, -Infinity];
  for (const value of invalidValues) {
    assert.throws(() => validateDiscountPercentage(value), invalidFareError);
  }
});
