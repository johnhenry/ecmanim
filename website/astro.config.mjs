// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Circuit's syntax palette is fixed across every erisera OSS site (see
// erisera-code/circuit's src/tokens.css) — reused verbatim here.
const circuitShikiTheme = {
  name: 'circuit',
  type: 'dark',
  colors: {
    'editor.background': '#0f172a',
    'editor.foreground': '#e2e8f0',
  },
  tokenColors: [
    { scope: ['comment'], settings: { foreground: '#8b93a1', fontStyle: 'italic' } },
    { scope: ['string', 'string.quoted'], settings: { foreground: '#0f9d63' } },
    { scope: ['keyword', 'keyword.control', 'storage.type', 'storage.modifier'], settings: { foreground: '#d6337d' } },
    { scope: ['entity.name.function', 'support.function'], settings: { foreground: '#1d6fbf' } },
    { scope: ['constant.numeric'], settings: { foreground: '#9333d6' } },
    { scope: ['entity.name.tag', 'meta.tag'], settings: { foreground: '#b45f06' } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: '#1d8f8f' } },
    { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'], settings: { foreground: '#7c4fd6' } },
    { scope: ['constant.language', 'constant.language.boolean'], settings: { foreground: '#c0392b', fontStyle: 'bold' } },
    { scope: ['punctuation', 'punctuation.definition', 'punctuation.separator'], settings: { foreground: '#94a3b8' } },
  ],
};

export default defineConfig({
  site: 'https://ecmanim.erisera.com',
  integrations: [
    starlight({
      title: 'ecmanim',
      tagline: 'A TypeScript port of manim — one Scene, three render targets.',
      logo: {
        src: './src/assets/logo.svg',
      },
      customCss: ['./src/styles/circuit-bridge.css'],
      expressiveCode: {
        themes: [circuitShikiTheme],
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/johnhenry/ecmanim' },
      ],
      sidebar: [
        { label: 'Overview', slug: 'index' },
        {
          label: 'Guides',
          items: [
            'guides/architecture',
            'guides/renderers',
            'guides/primitives',
            'guides/flex-group',
            'guides/physics',
            'guides/plugins',
            'guides/cli',
          ],
        },
        {
          label: 'Authoring',
          items: [
            'guides/authoring-studio',
            'guides/animation-presentation',
            'guides/voiceover',
            'guides/captions-audio',
            'guides/video',
          ],
        },
        {
          label: 'Interchange & metadata',
          items: ['guides/interchange', 'guides/metadata', 'guides/external-tools'],
        },
      ],
    }),
  ],
});
