import { Img, Rect, Txt, Video, makeScene2D } from '@revideo/2d';
import { createRef, useScene, waitFor } from '@revideo/core';

type Clip = { src: string; duration: number; start: number };

export default makeScene2D('casa', function* (view) {
  const clips = useScene().variables.get('clips', [] as Clip[])();
  const title = useScene().variables.get('title', 'Casa')();
  const logoSrc = useScene().variables.get('logoSrc', '/branding/logo-fixture.png')();
  const showLogo = useScene().variables.get('showLogo', true)();
  const cta = useScene().variables.get('cta', '')();
  const endCard = useScene().variables.get('endCard', 'Casa')();

  view.fill('#140f0c');

  for (const [index, clip] of clips.entries()) {
    const video = createRef<Video>();
    yield view.add(
      <Video
        ref={video}
        src={clip.src}
        width={1080}
        height={1920}
        play={true}
        time={clip.start ?? 0}
        decoder="web"
        zIndex={-2}
      />,
    );
    yield view.add(
      <>
        <Rect width={1080} height={280} y={-820} fill="rgba(20,15,12,0.55)" zIndex={-1} />
        <Rect width={1080} height={220} y={850} fill="rgba(20,15,12,0.45)" zIndex={-1} />
        {showLogo ? (
          <Img src={logoSrc} x={-414} y={-674} width={72} height={72} radius={8} />
        ) : null}
        <Txt
          text={title}
          fontFamily={'CenaSerif, Georgia, serif'}
          fontSize={40}
          fill="#f4efe6"
          x={0}
          y={-556}
          width={900}
          textAlign={'left'}
          textWrap={true}
        />
        {cta ? (
          <Txt
            text={cta}
            fontFamily={'Segoe UI, sans-serif'}
            fontSize={24}
            fill="#f4efe6"
            y={556}
            width={900}
          />
        ) : null}
      </>,
    );
    yield* waitFor(Math.max(0.8, clip.duration));
    video().remove();
    if (index < clips.length - 1) {
      yield* waitFor(0.12);
    }
  }

  yield view.add(
    <Rect width={1080} height={1920} fill="#140f0c">
      <Txt text={endCard} fontFamily={'CenaSerif, Georgia, serif'} fontSize={34} fill="#f4efe6" />
    </Rect>,
  );
  yield* waitFor(1.4);
});
