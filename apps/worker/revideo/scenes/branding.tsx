import { Audio, Img, Rect, Txt, makeScene2D } from '@revideo/2d';
import { useScene, waitFor } from '@revideo/core';

export default makeScene2D('branding', function* (view) {
  const endCard = useScene().variables.get('endCard', 'Casa')();
  const bedSrc = useScene().variables.get('bedSrc', '/runtime/silent.wav')();

  view.fill('#0a0a0a');
  yield view.add(<Audio src={bedSrc} play={true} />);
  yield view.add(
    <Rect width={1080} height={1920} fill="#0a0a0a">
      <Txt text={endCard} fontFamily={'CenaSerif, Georgia, serif'} fontSize={48} fill="#f4efe6" />
    </Rect>,
  );
  yield* waitFor(0.9);
});
