const PRIVATE_SUFFIXES = [
  ".local",
  ".internal",
  ".lan",
  ".corp",
  ".intranet",
];

export function toSiteKey(rawUrl: string): string {
  const u = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`);
  let host = u.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  let path = u.pathname.replace(/\/+$/, "");
  if (path === "/") path = "";
  return `${host}${path}`;
}

export function toSlug(siteKey: string): string {
  return siteKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isPublicEligibleUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return false;
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
    if (host.includes(":")) return false; // IPv6
    if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug) && slug.length <= 200;
}
