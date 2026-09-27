"""Retrieve guideline chunks for a question.

한국어는 띄어쓰기와 조사 때문에 단어 단위 매칭이 약하다("사전선택이란" vs "사전선택").
그래서 키워드 검색은 문자 2-gram 으로 하고, OpenAI 를 쓸 때는 임베딩 순위와
Reciprocal Rank Fusion 으로 섞는다. 임베딩은 뜻이 가까운 문장을, n-gram 은
'리볼빙'·'하이패스' 같은 고유 표현을 잘 잡는다.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any, Protocol

from .corpus import Chunk

RRF_K = 60
# 한국어 가이드라인 18문항 평가에서 임베딩 순위만으로는 개요·배경 청크가 자주 1위로
# 올라왔다(hit@1 11/18). 고유 표현이 많은 문서라 키워드 순위에 가중치를 더 준다
# (0.5:1 결합에서 hit@1 16/18, hit@3 18/18).
SEMANTIC_WEIGHT = 0.5
# 보도자료와 금융정책 게시글은 거의 같은 문장이라 둘 다 뽑히면 근거 칸만 차지한다.
DUPLICATE_JACCARD = 0.6


@dataclass(frozen=True, slots=True)
class ScoredChunk:
    chunk: Chunk
    score: float


class Retriever(Protocol):
    def search(self, query: str, k: int) -> list[ScoredChunk]: ...


def _grams(text: str, n: int = 2) -> list[str]:
    compact = re.sub(r"[^0-9a-z가-힣]", "", text.lower())
    return [compact[i:i + n] for i in range(len(compact) - n + 1)]


def _is_duplicate(chunk: Chunk, selected: list[ScoredChunk]) -> bool:
    grams = set(_grams(chunk.text, 3))
    for item in selected:
        other = set(_grams(item.chunk.text, 3))
        union = grams | other
        if union and len(grams & other) / len(union) >= DUPLICATE_JACCARD:
            return True
    return False


def _top_unique(ranked: list[ScoredChunk], k: int) -> list[ScoredChunk]:
    selected: list[ScoredChunk] = []
    for item in ranked:
        if item.score <= 0 or _is_duplicate(item.chunk, selected):
            continue
        selected.append(item)
        if len(selected) == k:
            break
    return selected


class LexicalRetriever:
    """BM25 over character bigrams. API 키 없이 동작하는 기본 검색기."""

    def __init__(self, chunks: list[Chunk], k1: float = 1.5, b: float = 0.75) -> None:
        self.chunks = chunks
        self.k1, self.b = k1, b
        self._docs = [Counter(_grams(chunk.search_text)) for chunk in chunks]
        self._lengths = [sum(doc.values()) for doc in self._docs]
        self._avg_length = sum(self._lengths) / len(self._lengths)
        document_frequency: Counter[str] = Counter()
        for doc in self._docs:
            document_frequency.update(doc.keys())
        total = len(chunks)
        self._idf = {
            gram: math.log(1 + (total - count + 0.5) / (count + 0.5))
            for gram, count in document_frequency.items()
        }

    def rank(self, query: str) -> list[ScoredChunk]:
        terms = set(_grams(query))
        scored = []
        for chunk, doc, length in zip(self.chunks, self._docs, self._lengths):
            score = 0.0
            for term in terms:
                frequency = doc.get(term, 0)
                if frequency:
                    norm = self.k1 * (1 - self.b + self.b * length / self._avg_length)
                    score += self._idf[term] * frequency * (self.k1 + 1) / (frequency + norm)
            scored.append(ScoredChunk(chunk, score))
        return sorted(scored, key=lambda item: item.score, reverse=True)

    def search(self, query: str, k: int) -> list[ScoredChunk]:
        return _top_unique(self.rank(query), k)


class HybridRetriever:
    """OpenAI 임베딩 + 문자 n-gram BM25 를 RRF 로 결합한다."""

    def __init__(self, chunks: list[Chunk], model: str, client: Any | None = None) -> None:
        if client is None:
            from openai import OpenAI
            client = OpenAI()
        self.chunks = chunks
        self.model = model
        self.client = client
        self.lexical = LexicalRetriever(chunks)
        self._vectors: list[list[float]] | None = None

    def _embed(self, texts: list[str]) -> list[list[float]]:
        response = self.client.embeddings.create(model=self.model, input=texts)
        return [_normalize(item.embedding) for item in response.data]

    def _index(self) -> list[list[float]]:
        # 코퍼스가 작아(수십 청크) 첫 질문 때 한 번에 임베딩해 메모리에 둔다.
        if self._vectors is None:
            self._vectors = self._embed([chunk.search_text for chunk in self.chunks])
        return self._vectors

    def search(self, query: str, k: int) -> list[ScoredChunk]:
        vectors = self._index()
        query_vector = self._embed([query])[0]
        semantic = sorted(
            range(len(self.chunks)),
            key=lambda i: sum(a * b for a, b in zip(query_vector, vectors[i])),
            reverse=True,
        )
        position = {chunk.id: index for index, chunk in enumerate(self.chunks)}
        lexical = [position[item.chunk.id] for item in self.lexical.rank(query)]
        fused: Counter[int] = Counter()
        for weight, ranking in ((SEMANTIC_WEIGHT, semantic), (1.0, lexical)):
            for rank, index in enumerate(ranking):
                fused[index] += weight / (RRF_K + rank + 1)
        ranked = [ScoredChunk(self.chunks[i], score) for i, score in fused.most_common()]
        return _top_unique(ranked, k)


def _normalize(vector: list[float]) -> list[float]:
    length = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / length for value in vector]
