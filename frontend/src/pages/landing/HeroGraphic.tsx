import { useId } from "react";

/** Two drifting contour families give the ribbon depth without a solid band. */
export function HeroGraphic() {
  const gradientId = useId();
  return (
    <div className="hero-graphic" aria-hidden="true">
      <svg viewBox="0 0 720 800" fill="none" focusable="false">
        <defs>
          <linearGradient
            id={gradientId}
            x1="100"
            y1="0"
            x2="620"
            y2="720"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#ff795c" stopOpacity="0.1" />
            <stop offset="0.35" stopColor="#ff795c" stopOpacity="0.9" />
            <stop offset="0.7" stopColor="#ff795c" stopOpacity="0.65" />
            <stop offset="1" stopColor="#ff795c" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <g className="hero-ribbon" strokeLinecap="round">
          {Array.from({ length: 42 }, (_, index) => {
            const t = index / 41;
            const spread = Math.sin(t * Math.PI);
            return (
              <path
                key={index}
                d={`M ${475 + t * 150} -100
                  C ${145 - spread * 75} ${45 + t * 40},
                    ${30 + t * 145} ${295 + t * 30},
                    ${205 + t * 95} ${450 + spread * 95}
                  C ${370 + t * 95} ${610 + spread * 150},
                    ${665 + t * 40} ${680 - t * 135},
                    880 ${440 + t * 50}`}
                stroke={`url(#${gradientId})`}
                strokeWidth={index === 0 || index === 41 ? 2 : 0.85}
                opacity={0.22 + Math.pow(Math.abs(t - 0.5) * 2, 1.3) * 0.78}
              />
            );
          })}
          {Array.from({ length: 16 }, (_, index) => {
            const t = index / 15;
            return (
              <path
                key={`inner-${index}`}
                d={`M ${360 + t * 145} -100 C ${175 + t * 35} 140, ${100 + t * 70} 345, ${325 + t * 45} ${445 + t * 35} S 715 ${590 + t * 40}, 880 390`}
                stroke={`url(#${gradientId})`}
                strokeWidth="0.85"
                opacity={0.12 + t * 0.3}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
