/** @type {import('next').NextConfig} */
const nextConfig = {
  // 표 자동 생성에 쓰는 SQL 파일을 서버 함수에 함께 싣는다
  outputFileTracingIncludes: { "/api/**": ["./supabase/setup.sql"] },
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/index.html" }] };
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }];
  },
};
export default nextConfig;
