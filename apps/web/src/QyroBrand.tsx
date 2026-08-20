export function QyroMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/qyro-logo.webp"
      alt="QyroCloud"
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: 'contain', borderRadius: 8 }}
      loading="eager"
      decoding="async"
    />
  );
}

export function QyroLogo({ height = 22 }: { height?: number }) {
  return (
    <img
      src="/qyro-logo.webp"
      alt="QyroCloud · LunixPanel"
      height={height}
      style={{ height, width: 'auto', objectFit: 'contain', display: 'block' }}
      loading="eager"
      decoding="async"
    />
  );
}
