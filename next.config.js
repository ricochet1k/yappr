/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable production source maps for better coverage attribution when requested
  productionBrowserSourceMaps: process.env.E2E_COVERAGE === '1',
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {hostname: 'images.unsplash.com'}, 
      {hostname: 'api.dicebear.com'},
    ],
  },
  webpack: (config, { isServer, dev }) => {
  //   // Optimize Dash SDK bundle size
  //   if (!isServer) {
  //     config.optimization = {
  //       ...config.optimization,
  //       splitChunks: {
  //         chunks: 'all',
  //         cacheGroups: {
  //           dash: {
  //             test: /[\\/]node_modules[\\/]dash[\\/]/,
  //             name: 'dash-sdk',
  //             priority: 10,
  //             reuseExistingChunk: true,
  //           },
  //         },
  //       },
  //     }
  //   }
    
    // Instrument client code for coverage during E2E when requested
    if (!isServer && process.env.E2E_COVERAGE === '1') {
      config.module.rules.push({
        test: /\.(ts|tsx|js|jsx)$/,
        exclude: /node_modules|\.test\.|e2e\/|lib\/wasm-sdk\//,
        use: {
          loader: 'istanbul-instrumenter-loader',
          options: { esModules: true },
        },
        enforce: 'post',
      })
    }

    // Handle WASM files
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    }
    // Use the client static directory in the server bundle and prod mode
    // Fixes `Error occurred prerendering page "/"`
    // config.output.webassemblyModuleFilename =
    //   isServer && !dev
    //     ? '../static/pkg/[modulehash].wasm'
    //     : 'static/pkg/[modulehash].wasm'
    // TODO: This is bad, it won't allow multiple wasm bundles but there seems to be a bug where the file is output with a different hash than it is imported with.
    config.output.webassemblyModuleFilename =
      isServer && !dev
        ? '../static/pkg/TODO_webassemblyModuleFilename_IS_BROKEN.wasm'
        : 'static/pkg/TODO_webassemblyModuleFilename_IS_BROKEN.wasm'
    
    return config
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self'",
              "connect-src 'self' https: wss: https://44.240.98.102:1443",
              "worker-src 'self' blob:",
              "child-src 'self' blob:"
            ].join('; ')
          },
          // CRITICAL: These headers are required for WASM to work
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp'
          },
          {
            key: 'Cross-Origin-Opener-Policy', 
            value: 'same-origin'
          }
        ]
      },
      {
        source: '/dash-wasm/:path*.wasm',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/wasm'
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp'
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin'
          }
        ]
      }
    ]
  }
}

module.exports = nextConfig
