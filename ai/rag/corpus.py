"""Load the dark-pattern knowledge files and split them into citable chunks."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

KNOWLEDGE_DIR = Path(__file__).resolve().parents[1] / "knowledge" / "dark_pattern"
# 한 섹션이 이보다 길면 문단 단위로 나눈다. 임베딩 한 개에 여러 주제가 섞이면
# 검색 정확도가 떨어지고, 너무 잘게 나누면 정의와 예시가 서로 떨어진다.
MAX_CHUNK_CHARS = 1200


@dataclass(frozen=True, slots=True)
class Chunk:
    id: str
    source_title: str
    source_file: str
    section: str
    text: str

    @property
    def search_text(self) -> str:
        """검색에 쓰는 본문. 섹션 제목을 붙여야 '반복간섭 예시' 같은 질문이 맞는다."""
        return f"{self.section}\n{self.text}"


def _parse_front_matter(raw: str) -> tuple[dict[str, str], str]:
    if not raw.startswith("---"):
        return {}, raw
    _, header, body = raw.split("---", 2)
    meta = {}
    for line in header.strip().splitlines():
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    return meta, body


def _split_long(text: str) -> list[str]:
    if len(text) <= MAX_CHUNK_CHARS:
        return [text]
    parts: list[str] = []
    current = ""
    for paragraph in re.split(r"\n\s*\n", text):
        if current and len(current) + len(paragraph) > MAX_CHUNK_CHARS:
            parts.append(current.strip())
            current = ""
        current += paragraph + "\n\n"
    if current.strip():
        parts.append(current.strip())
    return parts


def load_chunks(directory: Path = KNOWLEDGE_DIR) -> list[Chunk]:
    chunks: list[Chunk] = []
    for path in sorted(directory.glob("*.md")):
        meta, body = _parse_front_matter(path.read_text(encoding="utf-8"))
        title = meta.get("title", path.stem)
        source_file = meta.get("source_file", path.name)
        for index, block in enumerate(re.split(r"^## ", body, flags=re.MULTILINE)[1:]):
            section, _, text = block.partition("\n")
            parts = _split_long(text.strip())
            for part_index, part in enumerate(parts):
                # 나뉜 조각이 근거 목록에 같은 제목으로 두 번 보이지 않게 번호를 붙인다.
                label = section.strip() if len(parts) == 1 else (
                    f"{section.strip()} ({part_index + 1}/{len(parts)})"
                )
                chunks.append(Chunk(
                    id=f"{path.stem}-{index:02d}-{part_index}",
                    source_title=title,
                    source_file=source_file,
                    section=label,
                    text=part,
                ))
    if not chunks:
        raise RuntimeError(f"No knowledge chunks found in {directory}")
    return chunks
