/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Polyfill for Solana wallet adapter / umi / sns
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      os: false,
      path: false,
      crypto: false,
    };
    return config;
  },
};

module.exports = nextConfig;
