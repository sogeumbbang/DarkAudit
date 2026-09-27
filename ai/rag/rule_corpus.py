"""Turn the DarkAudit Rule Base (rules/dark_pattern_rules.yaml) into citable chunks.

규칙 YAML 이 단일 원본이다. 챗봇용 사본을 따로 두면 규칙을 고칠 때 둘이 어긋나므로,
질문 시점에 YAML 을 읽어 사람이 읽을 수 있는 문장으로 풀어 쓴다.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from ai.evaluation.evaluator import DEFAULT_EVALUATION_RULE_IDS

from .corpus import Chunk

RULES_PATH = Path(__file__).resolve().parents[2] / "rules" / "dark_pattern_rules.yaml"
SOURCE_FILE = "rules/dark_pattern_rules.yaml"

SCOPE = {
    "single_screen": "화면 1장으로 판단",
    "multi_screen": "여러 화면(Flow) 비교 필요",
    "dual_flow": "가입 Flow와 해지 Flow 대조 필요",
}
PRIORITY = {"P0": "MVP 필수", "P1": "우선 확대", "P2": "연동 이후"}
LABEL_UNIT = {
    "element": "요소 단위",
    "screen": "화면 단위",
    "flow": "Flow 단위",
    "flow_pair": "Flow 쌍 단위",
}


def _join(items: list[str]) -> str:
    return ", ".join(items) if items else "없음"


def _check_line(check: dict[str, Any]) -> str:
    threshold = f" (기준 {check['threshold']})" if check.get("threshold") else ""
    return f"- {check['id']}: {check['desc']}{threshold}"


def _rule_text(rule: dict[str, Any], categories: dict[str, Any], names: dict[str, str]) -> str:
    category = categories[rule["category"]]["ko"]
    detected = "예" if rule["rule_id"] in DEFAULT_EVALUATION_RULE_IDS else "아니요(규칙만 정의됨)"
    amplifiers = [f"{rid} {names.get(rid, '')}".strip() for rid in rule["combination_amplifiers"]]
    lines = [
        f"DarkAudit 탐지 규칙 {rule['rule_id']}: 가이드라인 {rule['official_no']} "
        f"'{rule['official_name_ko']}' 유형에 대응한다. 범주는 {category}이다.",
        f"정의: {rule['official_definition']}",
        f"탐지 범위: {SCOPE.get(rule['detection_scope'], rule['detection_scope'])} ({rule['detection_scope']}). "
        f"라벨 단위: {LABEL_UNIT.get(rule['label_unit'], rule['label_unit'])}. "
        f"우선순위: {rule['mvp_priority']}({PRIORITY.get(rule['mvp_priority'], '')}). "
        f"현재 자동 탐지 대상 여부: {detected}.",
        "단독 판정: " + (
            "가능. 단독 탐지 시 기본 심각도 HIGH."
            if rule["standalone_sufficient"]
            else "불가. 단독 탐지 시 REVIEW이며, 결합 증폭 유형이 함께 탐지되면 HIGH로 올린다."
        ),
        "결정적 체크(화면 속성으로 판별):",
        *(_check_line(check) for check in rule["deterministic_checks"]),
        "의미 판단 체크(모델이 판단):",
        *(f"- {item}" for item in rule["semantic_checks"]),
        "완화 요건(모두 충족 시 심각도 1단계 하향):" + ("" if rule["mitigating_checks"] else " 없음"),
        *(_check_line(check) for check in rule["mitigating_checks"]),
        f"결합 시 위험이 커지는 규칙: {_join(amplifiers)}",
        f"필요 증거: {_join(rule['required_evidence'])}",
        f"관련 법령·가이드라인: {_join(rule['legal_basis'])}",
        "가이드라인 사례:",
        *(f"- {example}" for example in rule["official_examples"]),
    ]
    if rule.get("fix_template"):
        lines.append(f"권장 수정 방향: {rule['fix_template']}")
    if rule.get("note"):
        lines.append("비고: " + " ".join(rule["note"].split()))
    if rule.get("input_requirement"):
        lines.append(f"입력 요건: {rule['input_requirement']}")
    return "\n".join(lines)


def _overview_text(data: dict[str, Any]) -> str:
    meta, categories, rules = data["meta"], data["categories"], data["rules"]
    policy = meta["severity_policy"]
    by_category: dict[str, list[str]] = {}
    for rule in rules:
        by_category.setdefault(rule["category"], []).append(
            f"{rule['rule_id']} {rule['official_name_ko']}({rule['mvp_priority']})"
        )
    lines = [
        f"DarkAudit Rule Base v{meta['version']}는 「{meta['source']['document']}」"
        f"({meta['source']['published']})의 15개 세부 유형을 DA-01~DA-15 규칙으로 옮긴 것이다.",
        *(f"- {categories[key]['ko']}: {', '.join(items)}" for key, items in by_category.items()),
        "현재 자동 탐지(MVP) 대상 규칙: " + ", ".join(sorted(DEFAULT_EVALUATION_RULE_IDS)) + ".",
        "우선순위: P0 MVP 필수, P1 우선 확대, P2 연동 이후.",
        "심각도 정책: 단독 판정 가능한 규칙은 기본 HIGH. 단독 판정 불가 규칙은 REVIEW로 두고, "
        f"{policy['standalone_false']['condition']}하면 HIGH로 올린다. "
        f"완화 요건을 모두 충족하면 {policy['mitigated']['action']}.",
        "평가 기준 소비자상: 숙고 없이 빠르게 결정하고 인터페이스 디자인에 크게 영향받는 디지털 취약 "
        "소비자를 전제하므로 경계 사례는 보수적으로 판정한다.",
        "탐지 범위: single_screen(화면 1장), multi_screen(화면 시퀀스 비교), dual_flow(가입·해지 Flow 대조).",
        "official_definition은 탐지용 내부 요약이며 법적 판단 기준이 아니다. 최종 판단은 사람이 검토한다.",
    ]
    return "\n".join(lines)


def load_rule_chunks(path: Path = RULES_PATH) -> list[Chunk]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    title = f"DarkAudit Rule Base v{data['meta']['version']}"
    names = {rule["rule_id"]: rule["official_name_ko"] for rule in data["rules"]}
    chunks = [Chunk("rules-overview", title, SOURCE_FILE, "DarkAudit 규칙 체계 개요", _overview_text(data))]
    for rule in data["rules"]:
        chunks.append(Chunk(
            id=f"rules-{rule['rule_id']}",
            source_title=title,
            source_file=SOURCE_FILE,
            section=f"{rule['rule_id']} {rule['official_name_ko']} ({rule['official_no']})",
            text=_rule_text(rule, data["categories"], names),
        ))
    return chunks
