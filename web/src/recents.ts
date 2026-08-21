const KEY = "crw.recent-repos";

export function loadRecentRepos(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string" && p.length > 0);
  } catch {
    return [];
  }
}

export function rememberRepo(path: string): string[] {
  const short = shortenRepo(path);
  if (!short) return loadRecentRepos();
  const next = [short, ...loadRecentRepos().filter((p) => p !== short)].slice(0, 12);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function displayRepo(path: string): string {
  const home = "/Users/grahammacaree";
  if (path === "~" || path === home || path === `${home}/`) return "";
  if (path.startsWith("~/")) return path.slice(2);
  if (path.startsWith(`${home}/`)) return path.slice(home.length + 1);
  return path;
}

export function shortenRepo(path: string): string {
  return displayRepo(path).trim().replace(/\/$/, "");
}
