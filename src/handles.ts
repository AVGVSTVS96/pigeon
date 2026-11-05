const PHONE = /^\+?[\d\s().-]{7,}$/u;
const LAST_TEN_DIGITS = -10;

const digits = (value: string): string => value.replaceAll(/\D/gu, "");

export const isPhone = (value: string): boolean =>
  PHONE.test(value.trim()) && digits(value).length >= 7;

export const handleKey = (value: string): string => {
  const trimmed = value.trim();

  return isPhone(trimmed) ? digits(trimmed).slice(LAST_TEN_DIGITS) : trimmed.toLowerCase();
};

export const sameHandle = (a: string, b: string): boolean => handleKey(a) === handleKey(b);
