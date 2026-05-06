/**
 * Shared color utility functions used by the PIXI renderers.
 */

/**
 * Multiply each RGB channel of a packed hex color by factor f, clamped to 255.
 * Used to generate lighter/darker variants of palette colors.
 */
export function lighten(hex: number, f: number): number {
  return (
    (Math.min(255, Math.round(((hex >> 16) & 0xff) * f)) << 16) |
    (Math.min(255, Math.round(((hex >> 8) & 0xff) * f)) << 8) |
    Math.min(255, Math.round((hex & 0xff) * f))
  );
}

/**
 * Convert a CSS hex color string ("#rrggbb") to a packed numeric color.
 */
export function hexToNum(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}
