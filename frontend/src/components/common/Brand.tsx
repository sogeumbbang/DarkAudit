import { Link } from "react-router-dom";

type BrandProps = { dark?: boolean };

export function Brand({ dark = false }: BrandProps) {
  return (
    <Link
      className={`inline-flex items-center text-xl font-bold tracking-tight ${dark ? "text-text" : "text-white"}`}
      to="/landing"
    >
      Dark<span className={dark ? "text-brand-600" : "text-brand-400"}>Audit</span>
    </Link>
  );
}
