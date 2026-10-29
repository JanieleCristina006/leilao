const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getApiPublicUrl() {
  const configuredUrl =
    process.env.API_PUBLIC_URL ?? process.env.PUBLIC_API_URL;
  const apiUrl =
    configuredUrl ??
    (process.env.NODE_ENV === 'production'
      ? ''
      : `http://localhost:${process.env.PORT ?? 3000}`);

  return apiUrl.replace(/\/+$/, '');
}

export function getArtworkProxyUrl(imageId: string) {
  return `${getApiPublicUrl()}/lots/artworks/image/${imageId}`;
}

export function normalizeArtworkImageUrl(
  imageUrl: string | null | undefined,
): string | null | undefined {
  if (!imageUrl) return imageUrl;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl, 'https://relative-image-url.invalid');
  } catch {
    return imageUrl;
  }

  const externalArtworkMatch = ['www.artic.edu', 'artic.edu'].includes(
    parsedUrl.hostname,
  )
    ? parsedUrl.pathname.match(/^\/iiif\/2\/([^/]+)/i)
    : null;
  const existingProxyMatch = parsedUrl.pathname.match(
    /^\/lots\/artworks\/image\/([^/]+)/i,
  );
  const imageId = externalArtworkMatch?.[1] ?? existingProxyMatch?.[1];

  if (!imageId || !UUID_PATTERN.test(imageId)) return imageUrl;

  return getArtworkProxyUrl(imageId);
}
