import "./landing.css";

/** The title screen's art, layer by layer: star field, the slatted sun behind the horizon, the mountains on it, the
 *  receding grid and grain. Colours are --landing-* tokens, re-skinned per theme. The picker reuses it. */
export function LandingScene() {
  return (
    <div className="landing-scene" aria-hidden="true">
      <span className="landing-stars-far" />
      <span className="landing-stars" />
      <span className="landing-skyband">
        <span className="landing-sun" />
      </span>
      <span className="landing-mountains" />
      <span className="landing-horizon" />
      <span className="landing-grid" />
      <span className="landing-noise" />
    </div>
  );
}
