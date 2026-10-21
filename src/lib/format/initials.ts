/**
 * Initials for an avatar: first letter of the first and last words ("Mara Okafor" → "MO"),
 * one letter for a single name, "" for a blank name. Handles extra whitespace and
 * non-BMP characters.
 */
export function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    const first = words[0];
    if (first === undefined) return '';

    const letter = (word: string) => Array.from(word)[0] ?? '';
    const last = words.length > 1 ? words[words.length - 1] : undefined;

    return (letter(first) + (last ? letter(last) : '')).toLocaleUpperCase();
}
