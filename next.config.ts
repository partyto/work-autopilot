import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["node-cron", "exceljs", "playwright", "unzipper"],
};

export default nextConfig;
