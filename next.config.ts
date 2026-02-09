import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  output: "export",
  basePath: process.env.PAGES_BASE_PATH || "",
};

export default nextConfig;
