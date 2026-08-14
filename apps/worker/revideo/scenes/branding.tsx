import { Audio, Img, Rect, Txt, makeScene2D } from '@revideo/2d';
import { useScene, waitFor } from '@revideo/core';

export default makeScene2D('branding', function* (view) {
  const title = useScene().variables.get('title', 'Casa')();
  const logoSrc = useScene().variables.get('logoSrc', '/branding/logo-fixture.png')();
  const showLogo = useScene().variables.get('showLogo', true)();
  const cta = useScene().variables.get('cta', '')();
  const endCard = useScene().variables.get('endCard', 'Casa')();
  const bedSrc = useScene().variables.get('bedSrc', '/runtime/silent.wav')();

  view.fill('#140f0c');
  yield view.add(<Audio src={bedSrc} play={true} />);
  yield view.add(
    <Rect width={1080} height={1920} fill="#140f0c">
      {showLogo ? <Img src={logoSrc} y={-220} width={96} height={96} radius={12} /> : null}
      <Txt
        text={title}
        fontFamily={'CenaSerif, Georgia, serif'}
        fontSize={54}
        fill="#f4efe6"
        y={40}
        width={860}
        textAlign={'center'}
        textWrap={true}
      />
      {cta ? (
        <Txt
          text={cta}
          fontFamily={'Segoe UI, sans-serif'}
          fontSize={28}
          fill="#d9cfc2"
          y={220}
          width={800}
          textAlign={'center'}
        />
      ) : null}
    </Rect>,
  );
  yield* waitFor(1.2);

  yield view.add(
    <Rect width={1080} height={1920} fill="#140f0c">
      <Txt text={endCard} fontFamily={'CenaSerif, Georgia, serif'} fontSize={40} fill="#f4efe6" />
    </Rect>,
  );
  yield* waitFor(1.2);
});
