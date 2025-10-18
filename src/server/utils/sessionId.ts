const letters = 'abcdefghijklmnopqrstuvwxyz';

const randomLetter = () => letters[Math.floor(Math.random() * letters.length)] ?? 'a';

const segment = () => Array.from({ length: 3 }, randomLetter).join('');

export const generateSessionId = () => `${segment()}-${segment()}-${segment()}`;
