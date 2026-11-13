import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Logoopplasting går via server actions; standardgrensen er 1 MB
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
};

export default nextConfig;
