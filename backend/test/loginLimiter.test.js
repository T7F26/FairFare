// Unit tests for the A1 login limiter. Run with: npm test
const { test } = require('node:test');
const assert = require('node:assert');
const { isLocked, recordFailure, recordSuccess, blockIfLocked } = require('../src/auth/loginLimiter');

const MINUTE = 60 * 1000;
const START = 0; // a pretend clock, so the tests don't wait 15 real minutes

function failTimes(email, times) {
  for (let i = 0; i < times; i++) recordFailure(email, START);
}

test('4 wrong passwords do not lock the account', () => {
  failTimes('a@test.ca', 4);
  assert.strictEqual(isLocked('a@test.ca', START), false);
});

test('5 wrong passwords lock the account', () => {
  failTimes('b@test.ca', 5);
  assert.strictEqual(isLocked('b@test.ca', START), true);
});

test('the account is still locked after 14 minutes', () => {
  failTimes('c@test.ca', 5);
  assert.strictEqual(isLocked('c@test.ca', START + 14 * MINUTE), true);
});

test('the account unlocks after 15 minutes', () => {
  failTimes('d@test.ca', 5);
  assert.strictEqual(isLocked('d@test.ca', START + 15 * MINUTE), false);
});

test('a correct password resets the count', () => {
  failTimes('e@test.ca', 4);
  recordSuccess('e@test.ca');
  failTimes('e@test.ca', 4);
  assert.strictEqual(isLocked('e@test.ca', START), false);
});

test('a locked account is refused even with the right password', () => {
  let reachedLogin = false;
  const res = {
    status(code) { this.code = code; return this; },
    json(data) { this.data = data; return this; },
  };

  // Use real time here, because the middleware checks the current time.
  for (let i = 0; i < 5; i++) recordFailure('f@test.ca');
  blockIfLocked({ body: { email: 'f@test.ca', password: 'right' } }, res, () => { reachedLogin = true; });

  assert.strictEqual(reachedLogin, false);
  assert.strictEqual(res.code, 423);
  assert.strictEqual(res.data.error, 'Account locked. Try again in 15 minutes.');
});
