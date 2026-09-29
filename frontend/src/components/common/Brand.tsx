import { Link } from "react-router-dom";

type BrandProps = { dark?: boolean };

export function Brand({ dark = false }: BrandProps) {
  return (
    <Link
      className={`inline-flex items-center font-display text-xl font-extrabold tracking-tight ${dark ? "text-text" : "text-white"}`}
      to="/landing"
    >
      Dark<span className={dark ? "text-brand-600" : "text-accent"}>Audit</span>
    </Link>
  );
}
