import type { ReactNode } from "react";
import { ScreenLadder } from "./ScreenParts";
import { MapStage, type Presentation } from "./ViewerApp";
import "./screen-picture.css";

/**
 * What the table screens show, drawn small in the GM's pages (table screen spec 2.3, ADR-0056): the live screen at
 * 1280 by 720 scaled to `width`, inert, with a text alternative. Every paired screen shows the same thing, so one
 * picture serves each card. With nothing presented it says so in place of the picture.
 */
export function ScreenPicture({
  presentation,
  mapImageUrl,
  token,
  width,
  children
}: Readonly<{
  presentation: Presentation | null;
  mapImageUrl: string | null;
  token: string;
  width: number;
  /** Over the picture: the remote's press surface. */
  children?: ReactNode;
}>) {
  const scale = width / 1280;
  const shown = presentation?.enabled && presentation.activeMap ? presentation : null;
  return (
    <div className="screen-picture" style={{ width, height: Math.round(720 * scale) }}>
      {shown ? (
        <>
          <p className="nh-sr-only">What the table screen shows: {shown.activeMap?.altText || "the map"}</p>
          <div className="screen-picture-frame" aria-hidden="true" style={{ transform: `scale(${scale})` }}>
            <div className="viewer-shell is-picture">
              <ScreenLadder presentation={shown} />
              <MapStage presentation={shown} mapImageUrl={mapImageUrl} authToken={token} />
            </div>
          </div>
        </>
      ) : (
        <p className="screen-picture-empty">{presentation?.enabled === false ? "Paused" : "Nothing on the screen"}</p>
      )}
      {children}
    </div>
  );
}
