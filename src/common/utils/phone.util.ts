// India-only for now (the client only offers a +91 country-code picker) —
// revisit DEFAULT_COUNTRY_CODE if/when the app supports other countries.
const DEFAULT_COUNTRY_CODE = '91';

/**
 * Canonicalize a phone number to `+<countrycode><nationalnumber>` so numbers
 * saved in different raw forms (device phonebook entries with/without a
 * country code, dashes, spaces, a leading trunk "0") all compare equal.
 *
 * Every place a phone number enters the system (registration, contact sync)
 * should normalize through this before it's matched or persisted — matching
 * two un-normalized strings with plain equality is what silently misses
 * contacts saved without a country code.
 */
export function normalizePhoneNumber(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return raw.trim();

    // Bare national number, e.g. "9876543210"
    if (digits.length === 10) {
        return `+${DEFAULT_COUNTRY_CODE}${digits}`;
    }

    // Leading trunk "0", e.g. "09876543210"
    if (digits.length === 11 && digits.startsWith('0')) {
        return `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
    }

    // Country code without "+", e.g. "919876543210"
    if (digits.length === 12 && digits.startsWith(DEFAULT_COUNTRY_CODE)) {
        return `+${digits}`;
    }

    // Already E.164-shaped (with or without the "+" that got stripped above),
    // or some other length/country code — best-effort passthrough.
    return `+${digits}`;
}
