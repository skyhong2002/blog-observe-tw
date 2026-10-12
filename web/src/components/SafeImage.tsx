import Image, { type ImageProps } from 'next/image';
import { articleImage } from '@/lib/images';

// Blog images are displayed directly in the browser, never fetched by the Next image proxy.
// Invalid sources render nothing; callers own the wrapper and drop it too (lib/images.ts).
export default function SafeImage({ src, alt = '', ...props }: Omit<ImageProps, 'src'> & { src: string | null | undefined }) {
  const image = articleImage(src);
  if (!image) return null;
  return <Image src={image} alt={alt} {...props} unoptimized referrerPolicy="no-referrer" />;
}
