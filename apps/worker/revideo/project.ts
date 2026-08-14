import { makeProject } from '@revideo/core';
import casa from './scenes/casa?scene';

export default makeProject({
  name: 'CenaPronta Casa',
  scenes: [casa],
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
    clips: [],
    logoSrc: '/branding/logo-fixture.png',
    showLogo: true,
    cta: '',
    endCard: 'Casa',
  },
});
