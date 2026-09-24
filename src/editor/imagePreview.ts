export function imagePreviewSource(url: string) {
  if (
    url.startsWith("vibenote-image://") ||
    url.startsWith("file://") ||
    /^https?:\/\//i.test(url)
  ) {
    return url;
  }
  if (url.startsWith("/")) {
    return `file://${url.split("/").map(encodeURIComponent).join("/")}`;
  }
  return "";
}

export function isPreviewableImageUrl(url: string) {
  return imagePreviewSource(url) !== "";
}
