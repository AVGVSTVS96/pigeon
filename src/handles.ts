const PHONE = /^\+?[\d\s().-]{7,}$/;

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

export function isPhone(value: string): boolean {
  return PHONE.test(value.trim()) && digits(value).length >= 7;
}

/**
 * One key per person, however the handle was written: phone numbers compare on
 * their last 10 digits, so "+1 (516) 555-0100" and "5165550100" are the same.
 */
export function handleKey(value: string): string {
  const trimmed = value.trim();
  return isPhone(trimmed) ? digits(trimmed).slice(-10) : trimmed.toLowerCase();
}

export function sameHandle(a: string, b: string): boolean {
  return handleKey(a) === handleKey(b);
}
