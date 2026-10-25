import SpaceBackground from './SpaceBackground';

/**
 * Fixed backdrop: two mirrored, slowly drifting copies of the theme wallpaper (1920 px, 3840 px on large or
 * high-DPI screens, chosen in CSS), film grain, and the flowing line layer.
 */
export default function Wallpaper() {
  return (
    <div className="wp" aria-hidden="true">
      <i />
      <i />
      <SpaceBackground />
    </div>
  );
}
