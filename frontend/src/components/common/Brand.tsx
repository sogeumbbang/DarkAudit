import { Link } from "react-router-dom";

import { brandLogo, type BrandTone } from "@/components/common/brandLogo";

export function Brand({ dark = false, compact = false }: BrandTone) {
  return (
    <Link className="inline-flex shrink-0 items-center" to="/landing">
      <img alt="DarkAudit" className="h-7 w-auto" src={brandLogo({ dark, compact })} />
    </Link>
  );
}
