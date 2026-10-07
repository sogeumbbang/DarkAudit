import logo from "@/assets/brand/logo.svg";
import logoMark from "@/assets/brand/logo-mark.svg";
import logoWhite from "@/assets/brand/logo-white.svg";

export type BrandTone = {
  /** Dark artwork for light backgrounds; the white logo is used otherwise. */
  dark?: boolean;
  /** Symbol only, for narrow spaces such as the mobile header. */
  compact?: boolean;
};

export function brandLogo({ dark = false, compact = false }: BrandTone = {}) {
  if (compact) return logoMark;
  return dark ? logo : logoWhite;
}
