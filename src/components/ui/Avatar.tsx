'use client';

import { clsx } from 'clsx';
import { useState } from 'react';

import { initials } from '@/lib/format/initials';

type AvatarProps = {
    name: string;
    /** Image URL; falls back to initials if it's missing or fails to load. */
    src?: string | null;
    size?: 'xs' | 'sm' | 'md';
    className?: string;
};

/** Square avatar: initials on neutral-300, or the user's image. */
export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
    // Remember which src failed, so a new src gets a fresh attempt.
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const showImage = Boolean(src) && src !== failedSrc;

    return (
        <span
            role="img"
            aria-label={name}
            title={name}
            className={clsx('avatar', `avatar-${size}`, className)}
        >
            {showImage && src ? (
                // Avatars are arbitrary user URLs, so next/image's remote allow-list doesn't fit.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={src}
                    alt=""
                    onError={() => setFailedSrc(src)}
                    // A server-rendered image can fail before hydration attaches onError.
                    ref={(img) => {
                        if (img?.complete && img.naturalWidth === 0) setFailedSrc(src);
                    }}
                />
            ) : (
                <span aria-hidden>{initials(name)}</span>
            )}
        </span>
    );
}
