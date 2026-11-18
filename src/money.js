const AMOUNT_RE = /^-?\d+(?:\.\d{1,2})?$/;

export class MoneyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

export function parseAmount(input) {
  if (typeof input !== 'string') {
    throw new MoneyError('INVALID_AMOUNT', 'amount must be a string');
  }
  const text = input.trim();
  if (!AMOUNT_RE.test(text)) {
    throw new MoneyError('INVALID_AMOUNT', `invalid amount: ${input}`);
  }
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) {
    throw new MoneyError('AMOUNT_OVERFLOW', 'amount out of safe range');
  }
  return negative && cents !== 0 ? -cents : cents;
}

export function addAmounts(...amounts) {
  if (amounts.some((value) => !Number.isSafeInteger(value))) {
    throw new MoneyError('INVALID_CENTS', 'cents must be integers');
  }
  const sum = amounts.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(sum)) {
    throw new MoneyError('AMOUNT_OVERFLOW', 'sum out of safe range');
  }
  return sum;
}

export function formatBRL(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new MoneyError('INVALID_CENTS', 'cents must be integers');
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

export function assertNonNegative(cents, context = 'amount') {
  if (!Number.isSafeInteger(cents)) {
    throw new MoneyError('INVALID_CENTS', 'cents must be integers');
  }
  if (cents < 0) {
    throw new MoneyError('NEGATIVE_AMOUNT', `${context} must be non-negative`);
  }
  return cents;
}
