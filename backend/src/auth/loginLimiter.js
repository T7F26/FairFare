// A1 Admin Log In: lock an account for 15 minutes after 5 wrong passwords.

const MAX_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes in milliseconds

// email -> { count, lockedUntil }
const attempts = {};

// Is this account locked right now?
function isLocked(email, now = Date.now()) {
  const account = attempts[email];
  return Boolean(account && account.lockedUntil > now);
}

// Call this after a wrong password.
function recordFailure(email, now = Date.now()) {
  if (isLocked(email, now)) return;

  const account = attempts[email] || { count: 0, lockedUntil: 0 };
  account.count += 1;

  if (account.count >= MAX_ATTEMPTS) {
    account.count = 0;
    account.lockedUntil = now + LOCK_TIME;
  }

  attempts[email] = account;
}

// Call this after a correct password.
function recordSuccess(email) {
  delete attempts[email];
}

// Put this before the login route. It stops locked accounts straight away.
function blockIfLocked(req, res, next) {
  if (isLocked(req.body?.email)) {
    return res.status(423).json({ error: 'Account locked. Try again in 15 minutes.' });
  }
  next();
}

module.exports = { isLocked, recordFailure, recordSuccess, blockIfLocked };
