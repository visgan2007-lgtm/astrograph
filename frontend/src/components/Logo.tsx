/** The Astrograph "A" on its own, no tile behind it. Colour comes from the theme via CSS. */
export default function Logo({ size = 34, label }: { size?: number; label?: string }) {
  return (
    <span
      className="logo-mark"
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
