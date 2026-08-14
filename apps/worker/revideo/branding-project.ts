import { makeProject } from '@revideo/core';
import branding from './scenes/branding?scene';

export default makeProject({
  name: 'CenaPronta Casa Branding',
  scenes: [branding],
  settings: {
    shared: {
      size: { x: 1080, y: 1920 },
      background: '#140f0c',
    },
    rendering: {
      fps: 30,
      exporter: {
        name: '@revideo/core/ffmpeg',
        options: { format: 'mp4' },
      },
    },
  },
  variables: {
    title: 'Casa',
    logoSrc: '/branding/logo-fixture.png',
    showLogo: true,
    cta: '',
    endCard: 'Casa',
    bedSrc: '/runtime/silent.wav',
  },
});
