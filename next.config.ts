import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Supabase Storage（環境変数のホストからの画像を許可）
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL
        ? [{ protocol: 'https' as const, hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname }]
        : []),
    ],
  },
};

export default nextConfig;
