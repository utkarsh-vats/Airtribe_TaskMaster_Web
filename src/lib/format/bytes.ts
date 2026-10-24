/*
 * File sizes in binary units (1 KB = 1024 B), the way file managers show them: "512 B",
 * "3.4 MB", "12 KB" — one decimal under 10 (dropped when it's .0), none from 10 up.
 */

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${Math.round(bytes)} B`;

    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    let text = value < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
    // 1023.7 KB rounds to "1024 KB": say "1 MB" instead.
    if (text === '1024' && unit < UNITS.length - 1) {
        text = '1';
        unit += 1;
    }
    return `${text} ${UNITS[unit]}`;
}
