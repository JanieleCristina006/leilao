const LOCAL_FRONTEND_ORIGIN = 'http://localhost:5173';

export function getAllowedFrontendOrigins() {
  const configuredOrigins = (process.env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set([LOCAL_FRONTEND_ORIGIN, ...configuredOrigins])];
}

export function checkFrontendOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allowed?: boolean) => void,
) {
  callback(null, !origin || getAllowedFrontendOrigins().includes(origin));
}
