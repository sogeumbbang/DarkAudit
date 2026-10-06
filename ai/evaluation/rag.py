"""Optional Ragas collections adapter; imports and API calls are explicit."""
from __future__ import annotations

import math
from importlib.metadata import version

from .metrics import ratio

RAG_FIELDS = {
    "faithfulness": ("user_input", "response", "retrieved_contexts"),
    "response_relevancy": ("user_input", "response"),
    "context_precision": ("user_input", "reference", "retrieved_contexts"),
    "context_recall": ("user_input", "reference", "retrieved_contexts"),
}


def validate_case(case: dict) -> None:
    for key in ("id", "user_input", "reference"):
        if not isinstance(case.get(key), str) or not case[key].strip():
            raise ValueError(f"RAG case requires nonempty {key}")
    if case.get("error"):
        return
    if not isinstance(case.get("response"), str) or not case["response"].strip():
        raise ValueError("RAG case requires nonempty response or an explicit collection error")
    contexts = case.get("retrieved_contexts")
    if not isinstance(contexts, list) or not contexts or any(not isinstance(x, str) or not x.strip() for x in contexts):
        raise ValueError("retrieved_contexts requires the full retrieved text, not citation IDs or excerpts")


def collect_rag_cases(questions: list[dict], chatbot) -> dict:
    """Trace the production ask path, preserving every retrieved chunk in order."""
    from ai.rag.chatbot import DarkPatternChatbot

    class RecordingRetriever:
        def __init__(self, inner):
            self.inner = inner
            self.context = []

        def search(self, query, k):
            self.context = self.inner.search(query, k)
            return self.context

    for question in questions:
        for key in ("id", "user_input", "reference"):
            if not isinstance(question.get(key), str) or not question[key].strip():
                raise ValueError(f"Question requires nonempty {key}")
    recorder = RecordingRetriever(chatbot.retriever)
    traced = DarkPatternChatbot(recorder, chatbot.generator, chatbot.rule_names)
    samples = []
    for question in questions:
        row = {key: question[key] for key in ("id", "user_input", "reference")}
        recorder.context = []
        try:
            answer = traced.ask(question["user_input"])
            row["response"] = answer.answer
            if not recorder.context:
                row["error"] = "no_retrieved_context"
        except Exception as exc:
            row.update(response="", error=type(exc).__name__)
        row["retrieved_contexts"] = [item.chunk.text for item in recorder.context]
        row["retrieved_context_ids"] = [item.chunk.id for item in recorder.context]
        samples.append(row)
    completed = sum(not row.get("error") for row in samples)
    return {"scope": "single-turn production chatbot; all retrieved chunks before citation filtering",
            "cases": len(samples), "evaluated_cases": completed,
            "coverage": ratio(completed, len(samples)), "failure_count": len(samples) - completed,
            "samples": samples}


def collect_live_rag(questions: list[dict], model: str, embedding_model: str) -> dict:
    from ai.rag.chatbot import DarkPatternChatbot, OpenAIAnswerGenerator, _rule_names
    from ai.rag.corpus import load_chunks
    from ai.rag.retriever import HybridRetriever
    from ai.rag.rule_corpus import load_rule_chunks

    chunks = [*load_chunks(), *load_rule_chunks()]
    chatbot = DarkPatternChatbot(HybridRetriever(chunks, embedding_model), OpenAIAnswerGenerator(model), _rule_names(chunks))
    report = collect_rag_cases(questions, chatbot)
    report.update(answer_model=model, embedding_model=embedding_model)
    return report


def create_metrics(model: str, embedding_model: str, client=None):
    try:
        from openai import AsyncOpenAI
        from ragas.llms import llm_factory
        from ragas.embeddings.base import embedding_factory
        from ragas.metrics.collections import AnswerRelevancy, ContextPrecision, ContextRecall, Faithfulness
    except ImportError as exc:
        raise RuntimeError("Install optional evaluation dependencies: pip install -r requirements-eval.txt") from exc
    client = client or AsyncOpenAI()
    llm = llm_factory(model, client=client)
    embeddings = embedding_factory("openai", model=embedding_model, client=client)
    return {
        "faithfulness": Faithfulness(llm=llm),
        "response_relevancy": AnswerRelevancy(llm=llm, embeddings=embeddings),
        "context_precision": ContextPrecision(llm=llm),
        "context_recall": ContextRecall(llm=llm),
    }, client


async def evaluate_rag(cases: list[dict], metrics: dict) -> dict:
    for case in cases:
        validate_case(case)
    if set(metrics) != set(RAG_FIELDS):
        raise ValueError("All four Ragas metrics are required")
    rows = []
    for case in cases:
        scores, errors = {}, {}
        for name, fields in RAG_FIELDS.items():
            if case.get("error"):
                scores[name] = None
                errors[name] = "collection_failed"
                continue
            try:
                result = await metrics[name].ascore(**{key: case[key] for key in fields})
                value = float(result.value)
                lower = -1 if name == "response_relevancy" else 0
                if not math.isfinite(value) or not lower <= value <= 1:
                    raise ValueError("Ragas returned an invalid score")
                scores[name] = value
            except Exception as exc:
                scores[name] = None
                errors[name] = type(exc).__name__
        rows.append({"id": case["id"], "scores": scores, "errors": errors})
    metrics_summary = {}
    for name in RAG_FIELDS:
        values = [row["scores"][name] for row in rows if row["scores"][name] is not None]
        metrics_summary[name] = {"mean": ratio(sum(values), len(values)), "evaluated_cases": len(values),
                                 "coverage": ratio(len(values), len(cases))}
    completed = sum(not row["errors"] for row in rows)
    return {"framework": "ragas", "cases": len(cases), "evaluated_cases": completed,
            "coverage": ratio(completed, len(cases)), "failure_count": len(cases) - completed,
            "metrics": metrics_summary, "per_case": rows}


async def run_ragas(cases: list[dict], model: str, embedding_model: str) -> dict:
    for case in cases:
        validate_case(case)
    metrics, client = create_metrics(model, embedding_model)
    try:
        report = await evaluate_rag(cases, metrics)
        report.update(framework_version=version("ragas"), judge_model=model, embedding_model=embedding_model)
        return report
    finally:
        await client.close()
