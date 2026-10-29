const LOCAL_FRONTEND_ORIGIN = 'http://localhost:5173';

export function getAllowedFrontendOrigins() {
  const configuredOrigins = (process.env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set([LOCAL_FRONTEND_ORIGIN, ...configuredOrigins])];
}
