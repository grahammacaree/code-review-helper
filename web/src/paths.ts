/**
 * Paths whose source is meant to be read as prose, not as code. The file pane
 * wraps these so a documentation paragraph is not cut off at the column edge.
 */
export function isProsePath(path: string): boolean {
  return /\.(mdx?|txt|rst|adoc)$/i.test(path);
}
