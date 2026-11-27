"use strict";

function fareValidationError(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function validateFare(value) {
  // Check the type and finiteness without coercing form input to a number.
  if (!Number.isFinite(value)) {
    throw fareValidationError("INVALID_FARE", "Enter a valid fare.");
  }

  if (value < 0) {
    throw fareValidationError("NEGATIVE_FARE", "Fare can't be negative");
  }

  return value;
}

function validateDiscountPercentage(value) {
  const percentage = validateFare(value);
  if (percentage > 100) {
    throw fareValidationError("INVALID_FARE", "Discount must be between 0 and 100.");
  }
  return percentage;
}

module.exports = { validateFare, validateDiscountPercentage };
