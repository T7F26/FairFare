"use strict";

function fareValidationError(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function validateNonNegativeNumber(value, negativeMessage) {
  // Check the type and finiteness without coercing form input to a number.
  if (!Number.isFinite(value)) {
    throw fareValidationError("INVALID_FARE", "Enter a valid fare.");
  }

  if (value < 0) {
    throw fareValidationError("NEGATIVE_FARE", negativeMessage);
  }

  return value;
}

function validateFare(value) {
  return validateNonNegativeNumber(value, "Fare can't be negative");
}

function validateDiscountPercentage(value) {
  const percentage = validateNonNegativeNumber(value, "Discount can't be negative");
  if (percentage > 100) {
    throw fareValidationError("INVALID_FARE", "Discount must be between 0 and 100.");
  }
  return percentage;
}

module.exports = { validateFare, validateDiscountPercentage };
