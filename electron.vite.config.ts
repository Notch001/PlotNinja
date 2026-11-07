import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@core': resolve(__dirname, 'src/core')
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: { alias },
    build: {
      // Gebündelte Schriften als data:-URL einbetten (fetch funktioniert so auch aus file://); alles andere wie üblich
      assetsInlineLimit: (file: string) => (file.endsWith('.ttf') ? true : undefined),
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
