import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function repositoryBase(): string {
  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
  return process.env.GITHUB_ACTIONS === 'true' && repository ? `/${repository}/` : '/';
}

export default defineConfig({
  base: repositoryBase(),
  plugins: [
    react(),
    {
      name: 'production-csp',
      apply: 'build',
      transformIndexHtml(html) {
        return html.replace(
          '<!-- production-csp -->',
          '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\'; connect-src \'none\'; worker-src \'self\' blob:; object-src \'none\'; frame-src \'none\'; base-uri \'self\'; form-action \'none\'">',
        );
      },
    },
  ],
});
