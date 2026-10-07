import { Link } from "react-router-dom";

import { brandLogo, type BrandTone } from "@/components/common/brandLogo";

export function Brand({ dark = false, compact = false }: BrandTone) {
  return (
    <Link className="inline-flex shrink-0 items-center text-xl" to="/landing">
      <img
        src={brandLogo({ dark, compact })}
        alt="DarkAudit"
        width={compact ? 124 : 604}
        height="140"
        className={compact ? "h-7 w-auto" : "h-[1.3em] w-auto"}
      />
    </Link>
  );
}
