'use client';

import Image from 'next/image';
import { useState, type ComponentProps } from 'react';
import { productPhotoSource, stockProductPhoto } from '../lib/product-photos';

type Props = Omit<ComponentProps<typeof Image>, 'src' | 'onError' | 'alt'> & {
  product: { name: string; category?: string | null; image_url?: string | null };
  illustrativeFallback?: boolean;
};

export default function ProductPhoto({ product, illustrativeFallback = true, ...props }: Props) {
  const fallback = illustrativeFallback ? stockProductPhoto(product.name, product.category ?? '') : '';
  const primary = productPhotoSource(product.image_url, fallback);
  const [failedSource, setFailedSource] = useState<string>();
  const source = failedSource === primary ? fallback : primary;
  if (!source) return null;
  return <Image {...props} unoptimized src={source} alt="" loading="lazy"
    onError={() => { if (source !== fallback) setFailedSource(source); }} />;
}
