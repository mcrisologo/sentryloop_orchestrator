const DEFAULT_ALLOWED_HOSTS = ["sentry.io"];

function allowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.SENTRY_ALLOWED_HOSTS?.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_ALLOWED_HOSTS;
}

export function validateSentryIssueUrl(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Sentry issue URL is invalid.");
  }

  const hostname = url.hostname.toLowerCase();
  const hostAllowed = allowedHosts(env).some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
  );
  if (url.protocol !== "https:" || !hostAllowed || !url.pathname.includes("/issues/")) {
    throw new Error(
      "Sentry issue URL must be HTTPS, use an allowed Sentry host, and contain /issues/.",
    );
  }
  if (url.username || url.password) {
    throw new Error("Sentry issue URL must not include credentials.");
  }

  url.hash = "";
  return url.toString();
}
