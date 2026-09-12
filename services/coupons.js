// Coupon system for Ocean SFT.
// - Daily rotating discount codes (10/15/20/25%) are derived deterministically
//   from the date, so checkout + admin always agree without any manual entry.
// - Founder trial codes (e.g. `minhazul-free`) grant a free trial month and are
//   approved by the admin via an email button link.

var DAILY_TIERS = [
  { pct: 10, prefix: 'OCEAN10' },
  { pct: 15, prefix: 'OCEAN15' },
  { pct: 20, prefix: 'OCEAN20' },
  { pct: 25, prefix: 'OCEAN25' }
];

// Founder / free-trial codes. Extend this list to add more.
var TRIAL_CODES = [
  { code: 'minhazul-trial', months: 1, founder: 'minhazul', label: 'Free 1 Month (Founder)' },
  { code: 'minhazul-free', months: 1, founder: 'minhazul', label: 'Free 1 Month (Founder)' }
];

function dateKey(d) {
  var date = d || new Date();
  var y = date.getFullYear();
  var m = ('0' + (date.getMonth() + 1)).slice(-2);
  var day = ('0' + date.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
}

// Deterministic short token derived from the date so the same code is shown
// consistently in checkout and admin for a given day.
function dayToken(dateStr) {
  var seed = 'OCEAN-SFT-' + dateStr;
  var h = 7;
  for (var i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).toUpperCase().slice(0, 4);
}

// Full list of today's discount codes (visible in admin).
function getDailyCodes(date) {
  var key = dateKey(date);
  var token = dayToken(key);
  return DAILY_TIERS.map(function (tier) {
    return {
      code: tier.prefix + '-' + token,
      prefix: tier.prefix,
      pct: tier.pct,
      date: key,
      token: token
    };
  });
}

function getTrialCodes() {
  return TRIAL_CODES.slice();
}

// Resolve an entered coupon string.
// Returns { type:'percent', pct, code } | { type:'trial', months, founder, code } | null
function resolveCoupon(raw, date) {
  var code = String(raw || '').trim().toUpperCase();
  if (!code) return null;

  var daily = getDailyCodes(date);
  var matched = null;
  daily.forEach(function (tier) {
    if (!matched && tier.code.toUpperCase() === code) {
      matched = { type: 'percent', pct: tier.pct, code: tier.code };
    }
  });
  if (matched) return matched;

  var trial = null;
  TRIAL_CODES.forEach(function (t) {
    if (!trial && String(t.code).trim().toUpperCase() === code) {
      trial = { type: 'trial', months: Number(t.months) || 1, founder: t.founder || '', code: t.code, label: t.label || 'Free Trial' };
    }
  });
  return trial;
}

function randomToken(len) {
  var out = '';
  var pool = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (var i = 0; i < (len || 20); i++) {
    out += pool.charAt(Math.floor(Math.random() * pool.length));
  }
  return out;
}

module.exports = {
  DAILY_TIERS: DAILY_TIERS,
  TRIAL_CODES: TRIAL_CODES,
  dateKey: dateKey,
  dayToken: dayToken,
  getDailyCodes: getDailyCodes,
  getTrialCodes: getTrialCodes,
  resolveCoupon: resolveCoupon,
  randomToken: randomToken
};
