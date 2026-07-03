/**
 * slugify — Convert a name to a URL-safe slug.
 * "Hello World" → "hello-world"
 */
export const slugify = (name = '') =>
  name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

/**
 * unslugify — Convert a slug back to a readable name (for display fallback).
 * "hello-world" → "Hello World"
 */
export const unslugify = (slug = '') =>
  slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
