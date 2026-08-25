export function imagePreviewSource(url: string) {
  if (
    url.startsWith("vibenote-image://") ||
    url.startsWith("file://") ||
    /^https?:\/\//i.test(url)
  ) {
    return url;
  }
  if (url.startsWith("/")) {
    return `file://${encodeURI(url)}`;
  }
  return "";
}

export function isPreviewableImageUrl(url: string) {
  return imagePreviewSource(url) !== "";
}
