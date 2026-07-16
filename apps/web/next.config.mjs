/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@scadium/shared', '@scadium/fair', '@scadium/ui'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  images: {
    // Locked down: no external image hosts are used (avatars are data-URLs /
    // local presets), and a wildcard `hostname: '**'` turns the deployment into
    // an open, paid image proxy for any host. Add explicit patterns here only if
    // a real remote image source is introduced.
    remotePatterns: [],
  },
};

export default nextConfig;
