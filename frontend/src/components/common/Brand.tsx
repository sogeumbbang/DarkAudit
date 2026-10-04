import { Link } from "react-router-dom";

type BrandProps = { dark?: boolean };

export function Brand({ dark = false }: BrandProps) {
  return (
    <Link
      className={`inline-flex items-center font-display text-xl font-semibold tracking-[-0.055em] ${dark ? "text-text" : "text-white"}`}
      to="/landing"
    >
      Dark<span>Audit</span>
      <span aria-hidden="true" className="ml-1 text-accent-ink">
        .
      </span>
    </Link>
  );
}
