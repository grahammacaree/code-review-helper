/**
 * Specs, suites, and the harness that exists only to drive them. Shared so
 * queue ranking, risk scoring, and call-site sampling agree on what a "test"
 * path is — including stubs under test-utils that are not themselves *.test.*.
 */
export function isTestPath(path: string): boolean {
  const p = path.toLowerCase();
  return (
    /\.(test|spec)\./.test(p) ||
    /\.stories\.[cm]?[jt]sx?$/.test(p) ||
    /(^|\/)(__tests__|tests?|spec)\//.test(p) ||
    /(^|\/)(test-utils|testing|__mocks__|__fixtures__|fixtures|mocks)(\/|$)/.test(
      p,
    ) ||
    /(^|\/)(jest\.setup|setupTests?)\.[cm]?[jt]sx?$/.test(p)
  );
}
