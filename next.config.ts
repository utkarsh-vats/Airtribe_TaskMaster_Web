import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    reactStrictMode: true,
    // Lets a verification build go to its own folder (NEXT_DIST_DIR=.next-verify) so it never
    // touches the .next a running `npm run dev` uses (CLAUDE.md).
    ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
