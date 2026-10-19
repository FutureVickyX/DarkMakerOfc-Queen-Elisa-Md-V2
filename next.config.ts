import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Camera is used for capture on this origin only.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // OpenCV.js is loaded at runtime from /vendor inside a Web Worker; keep it out of server bundles.
  serverExternalPackages: ["@techstark/opencv-js"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/vendor/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, immutable" }],
      },
    ];
  },
};

export default nextConfig;
