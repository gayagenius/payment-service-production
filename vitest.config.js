import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.js', 'src/**/*.test.js'],
    exclude: ['node_modules/**', 'dist/**']
  }
})
