/**
 * Original Unsplash photographs, selected for the fictional pet-insurance example
 * and the people behind financial choices. Not customer endorsements.
 * Source pages list the Unsplash License (https://unsplash.com/license).
 * Retrieved 2026-10-04. Local WebP variants prevent third-party runtime requests.
 */
const photographs = {
  workspace: {
    src: "/landing/review-at-desk-1200.webp",
    srcSet: "/landing/review-at-desk-600.webp 600w, /landing/review-at-desk-1200.webp 1200w",
    width: 1200,
    height: 800,
    alt: "창가 책상에서 노트북 화면을 살펴보는 사람",
    photographer: "Gabriel Weyand",
    source: "https://unsplash.com/photos/person-working-on-a-laptop-at-a-desk-pPpUCaudT5Q",
  },
  choice: {
    src: "/landing/people-and-choice-1600.webp",
    srcSet: "/landing/people-and-choice-800.webp 800w, /landing/people-and-choice-1600.webp 1600w",
    width: 1600,
    height: 1067,
    alt: "야외에서 반려견과 함께 앉아 있는 두 사람",
    photographer: "Samuell Morgenstern",
    source: "https://unsplash.com/photos/two-women-and-a-dog-sit-together-outdoors-e4JGLT20ihU",
  },
  pet: {
    src: "/landing/pet-everyday-600.webp",
    srcSet: "/landing/pet-everyday-600.webp 600w, /landing/pet-everyday-1200.webp 1200w",
    width: 1200,
    height: 1680,
    alt: "파란 벤치에 앉아 코기 반려견을 안고 있는 두 사람",
    photographer: "Ali Colina",
    source: "https://unsplash.com/photos/couple-with-corgi-dog-sitting-on-a-blue-bench-Pv68gBV5rsQ",
  },
} as const;

export function LandingPhoto({
  kind,
  sizes,
  priority = false,
}: {
  kind: keyof typeof photographs;
  sizes: string;
  priority?: boolean;
}) {
  const photo = photographs[kind];
  return (
    <img
      className={`lp-photo lp-photo-${kind}`}
      src={photo.src}
      srcSet={photo.srcSet}
      sizes={sizes}
      width={photo.width}
      height={photo.height}
      alt={photo.alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
    />
  );
}

export function PhotoCredits() {
  return (
    <div className="lp-photo-credits">
      <span>Photography</span>
      {Object.values(photographs).map((photo) => (
        <a href={photo.source} key={photo.source} target="_blank" rel="noreferrer">
          {photo.photographer} <span className="sr-only">사진 원본 (새 창)</span>
        </a>
      ))}
      <span>/ Unsplash</span>
    </div>
  );
}
