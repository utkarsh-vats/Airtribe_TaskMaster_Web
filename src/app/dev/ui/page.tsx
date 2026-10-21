import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Gallery } from './Gallery';

export const metadata: Metadata = { title: 'UI kit' };

// Dev-only component gallery (the prototype's "Tokens & components" view).
export default function DevUiPage() {
    if (process.env.NODE_ENV === 'production') notFound();

    return <Gallery />;
}
