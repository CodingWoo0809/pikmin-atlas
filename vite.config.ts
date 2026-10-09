import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' 는 GitHub Pages의 하위 경로(/nomad-atlas/)에서도 파일을 찾을 수 있게 해 준다.
// 화면 주소는 Hash Routing(/#/...)을 쓰므로 새로고침해도 404가 나지 않는다.
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    sourcemap: false,
  },
});
