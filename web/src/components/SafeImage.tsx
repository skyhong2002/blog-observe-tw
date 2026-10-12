import Image, { type ImageProps } from 'next/image';
// Blog images are displayed directly in the browser, never fetched by the Next image proxy.
export default function SafeImage({ src, alt = '', ...props }: Omit<ImageProps, 'src'> & { src: string | null | undefined }) {
  if (!src) return null;
  try {
    const url = new URL(src);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.includes('.') ||
      /^[\d.]+$/.test(url.hostname)
    )
      return null;
  } catch {
    return null;
  }
  return <Image src={src} alt={alt} {...props} unoptimized referrerPolicy="no-referrer" />;
}
