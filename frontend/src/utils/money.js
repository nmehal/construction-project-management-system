// Work with decimal strings only: no binary floating-point money conversion.
export function normalizeMoney(value) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new Error('Enter an amount with up to two decimal places.');
  }
  const input = value.trim();
  const negative = input.startsWith('-');
  const [whole, fraction = ''] = input.replace(/^-/, '').split('.');
  const units = whole.replace(/^0+(?=\d)/, '');
  const cents = fraction.padEnd(2, '0');
  const sign = negative && (units !== '0' || cents !== '00') ? '-' : '';
  return `${sign}${units}.${cents}`;
}
export function formatAUD(value) {
  try {
    const normalized = normalizeMoney(value);
    const negative = normalized.startsWith('-');
    const [units, cents] = normalized.replace(/^-/, '').split('.');
    return `${negative ? '-' : ''}A$${units.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
  } catch { return 'Unavailable'; }
}
