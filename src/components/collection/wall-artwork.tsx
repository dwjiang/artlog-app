import { DisplayMedia } from '@/components/artwork/display-media';
import { wallAspect, type WallPiece } from '@/lib/wall/wall-layout';
import { SavedWorkImage } from './saved-work-image';
import { WallFrame, wallFrameInset } from './wall-frame';

export function WallArtwork({ piece, width }: { piece: WallPiece; width: number }) {
  const innerWidth = Math.max(1, width - wallFrameInset(piece.layout.frame, width) * 2);
  return <WallFrame frame={piece.layout.frame} width={width}>
    {piece.cropPath ? <SavedWorkImage path={piece.cropPath} title={piece.artwork.title} contain
      style={{ width: innerWidth, aspectRatio: wallAspect(piece) }} />
      : <DisplayMedia media={piece.artwork.media} label={piece.artwork.title} width={innerWidth} />}
  </WallFrame>;
}

