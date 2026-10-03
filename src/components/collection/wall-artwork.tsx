import { DisplayMedia } from "@/components/artwork/display-media";
import { wallAspect, type WallPiece } from "@/lib/wall/wall-layout";
import { wallFrameInset } from "@/shared/wall/frames";

import { SavedWorkImage } from "./saved-work-image";
import { WallFrame } from "./wall-frame";

export function WallArtwork({ piece, width }: { piece: WallPiece; width: number }) {
  const inset = wallFrameInset(piece.layout.frame, width);
  const innerWidth = Math.max(1, width - inset * 2);
  const innerHeight = innerWidth / wallAspect(piece);
  return (
    <WallFrame frame={piece.layout.frame} width={width} height={innerHeight + inset * 2}>
      {piece.cropPath ? (
        <SavedWorkImage
          path={piece.cropPath}
          title={piece.artwork.title}
          contain
          style={{ width: innerWidth, height: innerHeight }}
        />
      ) : (
        <DisplayMedia media={piece.artwork.media} label={piece.artwork.title} width={innerWidth} height={innerHeight} />
      )}
    </WallFrame>
  );
}
