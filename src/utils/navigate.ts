export function isUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) || /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*\.[a-z]{2,}(\/.*)?$/i.test(input);
}

export function resolveUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*\.[a-z]{2,}(\/.*)?$/i.test(input)) {
    return 'https://' + input;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}
