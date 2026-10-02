# DarkAudit 성능 재측정 준비 및 결과 템플릿

- 작성일: 2026-10-02 / 현재 커밋: `614bc1a` (2026-09-29)
- 근거 표기: `파일경로:라인`, 추측은 [추정]. 재측정 값 칸은 **비워 둔 채** 승인 후 채운다.
- **Rule Engine 단독**과 **단위 테스트**는 오늘 실행했다(§4). **Hybrid(LLM 호출)는 실행하지 않았다**(§5, 승인 대기).

---

## 1. 평가 스크립트·데이터셋

### 1.1 스크립트

| 스크립트 | 실행 | LLM 호출 | 출력 |
| --- | --- | --- | --- |
| `backend/eval_rule_engine.py` | `cd backend && python eval_rule_engine.py` (인자·환경변수 없음) | 없음 | 콘솔 표 + `docs/eval/rule_engine_report.json` **덮어씀** (`:30,160`) |
| `backend/eval_hybrid.py` | `cd backend && python eval_hybrid.py --runs 3` (`--flows a,b` 로 일부만) | **있음** | `docs/eval/hybrid_report.json` + `hybrid_report.{model}.json` **덮어씀**, 예측 원본 `docs/eval/hybrid/run-N/`(gitignore) |
| `backend/compare_eval.py` | `python compare_eval.py` | 없음 | 콘솔 표(`hybrid_report.{model}.json`들 비교) |
| `ai/cli.py evaluate` | `python -m ai.cli evaluate --predictions <dir> [--dataset data/synthetic/labels] [--iou-threshold 0.5]` | 없음 | JSON(stdout) |

### 1.2 필요 환경

| 항목 | Rule Engine | Hybrid |
| --- | --- | --- |
| Python 패키지 | `requirements.txt` + Playwright chromium(UI 추출용) | 동일 |
| 환경변수 | 없음 | `OPENAI_API_KEY`(필수 `eval_hybrid.py:189`), `DARKAUDIT_MODEL`(필수, 기본값 없음 `factory.py:11`), `DARKAUDIT_PROVIDER`는 openai로 자동 설정(`:191`), 루트 `.env` 자동 로드(`:47-55`) |
| OCR | 불필요 | Tesseract(kor+eng) — **이 PC에는 설치돼 있지 않다**(`which tesseract` 없음). 없으면 위치 보정이 빈 결과가 된다 [추정] |
| 입력 데이터 | `data/synthetic/ui/*.json` | 위 + `data/synthetic/screenshots/{flow}/*.png` |

`ui/`, `screenshots/`, `html/`은 생성물이라 **저장소에 없다**(`.gitignore`). 재생성:
```bash
cd data/generator
for c in configs/*.json; do python generate.py --config $c; done   # HTML
python extract_ui.py --all                                          # ui/*.json (Rule Engine용)
for c in configs/*.json; do python capture.py --config $c; done    # 스크린샷+라벨 (라벨이 덮일 수 있음 [추정])
```

### 1.3 데이터셋 (`data/synthetic/labels/`)

| 항목 | 값 |
| --- | --- |
| flow 수 | 22 = 11쌍(risky 11 + clean 11). 보험 ins-001~009, 예적금 dep-001~002. 대출·투자 없음 |
| 화면 수 | 110 (flow당 5화면, 390×844) |
| 정답 라벨 위치 | `data/synthetic/labels/{flow_id}.json` (clean은 `labels: []`) |
| 라벨 수(MVP 5종) | DA-03 3, DA-04 4, DA-07 7, DA-12 3, DA-15 3(flow 단위) = **20 인스턴스** / flow-존재 단위 **16** (DA-07이 3개 flow에 걸침) |
| 평가 범위 밖 라벨 | DA-05 3, DA-13 3 |
| `ai/tests/golden_cases.jsonl` | 2줄. 단위테스트용이며 평가 데이터셋이 아니다 |

> **집계 단위가 다르다.** Rule Engine = (rule, screen_index) 단위(`eval_rule_engine.py:38-48`), Hybrid = flow 내 규칙 존재 단위(`ai/evaluation/evaluator.py:65-79`). 두 표를 직접 비교하면 안 된다. 한계: 라벨이 생성기가 심은 패턴 기준이다(`data/generator/README.md`).

---

## 2. 측정 가능한 지표

| 지표 | Rule Engine 단독 | Hybrid | 비고 |
| --- | --- | --- | --- |
| Precision / Recall / micro F1 | ✔ | ✔ | `metrics.py:3-10` |
| Macro F1 | ✔(F1만) | ✔(P/R/F1) | `evaluator.py:90` |
| 유형별 P/R/F1 | ✔ | ✔ | 5종 |
| 위치 정확도(IoU 0.5) | ✘ (bbox 비교 없음) | ✔ `localization.success_rate`, `instance_detection` | `evaluator.py:114-126`, 기본 0.5 |
| Counterfactual 일관성 | ✘ | ✔ | `evaluator.py:113` |
| 판정 일관성(반복 N회) | 결정적이라 해당 없음 | ✔ `--runs N` → `variation` | `eval_hybrid.py:212-220` |
| 평균 응답 시간 | ✘ | ✔ `operations.average_response_time_seconds` | `evaluator.py:118-123` |
| 스키마 재시도율 | ✘ | ✔ | 〃 |
| **FPR** (FP/(FP+TN)) | **코드 없음** | **코드 없음** | 기획서 6-1 목표 지표. clean 11 flow로 추가 산출 가능 [추정] |
| 화면당 검수시간 / Human Review 일치도 | ✘ | ✘ | 미구현(F-28) |
| 비용/화면 | ✘ | 구조는 있으나 이전 리포트는 `null` | 단가 인자 필요(`ai/cli.py`) |

---

## 3. 이전 측정값 (기록 위치·시점)

| 리포트 | 측정 시각(KST) | 모델 | 규모 | 기록 커밋 | 비고 |
| --- | --- | --- | --- | --- | --- |
| `rule_engine_report.json` | 2026-09-06 20:20 | — | 22 flow / 110 화면 | git `1595a75` | 리포트 내 해시 없음. **오늘 재현 완료(§4)** |
| `hybrid_report.json` = `.gpt-5.6-luna.json` | 2026-09-06 17:42 | gpt-5.6-luna | 3 runs × 22 flow | git `88a3057`(18:12) | 두 파일 바이트 동일 |
| `hybrid_report.gpt-5.4-mini.json` | 2026-09-06 15:48 | gpt-5.4-mini | 3 runs × 22 flow | git `6028a44` | 근거 검증 도입 **이전** 값. 현재 코드와 비교 불가 |

### 측정 당시 → 현재 사이 평가에 영향 줄 변경

| 기준 | 변경 |
| --- | --- |
| Rule Engine(20:20) → HEAD | AI/규칙/엔진/프롬프트/데이터 경로 변경 **없음**(마지막 `6d25907`). 실제로 오늘 재실행 결과가 커밋된 리포트와 일치 |
| Hybrid luna(17:42) → HEAD | `62a62da`(18:20, 단일 화면 규칙에 화면이 여러 개 올 때 실패 수정), `7a6c584`(18:27, 화면 축소 시 관련 요소 참조 끊김 수정) — 둘 다 `ai/pipeline/response_parser.py`(+48줄). 이후 09-29까지 AI 경로 변경 없음 |
| Hybrid mini(15:48) → HEAD | 위 2건 + `57ec857`(증거 계약 강화), `0089ff7`(스크린샷 탐지를 canonical rules에 정렬), `6d25907`(DA-07 후보 폭주 수정). **재측정 대상이 아님** |
| 외부 변수 | 모델 업데이트·서버 측 변경은 알 수 없음 [추정]. 이전 리포트에는 커밋 해시·프롬프트 버전이 기록되지 않았다 |

> 기획서 7-2 수치(Rule Engine 0.27/1.00/0.43, Hybrid 0.46/1.00/0.63)는 위 JSON과 **다르다**. 기획서가 갱신되지 않은 것으로 보인다.

---

## 4. 오늘 실행한 결과 (API 호출 없음)

### 4.1 단위 테스트 (가상환경, `DARKAUDIT_PROVIDER=fake`, `PYTHONUTF8=1`)

| 스위트 | 결과 |
| --- | --- |
| `ai/tests` | **106개 통과, 1 skip** (최초 시도는 playwright 미설치로 import 오류 → venv 구성 후 통과) |
| `backend/tests` | **93개 통과** (출력의 `chatbot request failed … boom`은 예외 처리 테스트가 의도적으로 낸 로그) |
| `rules/build_rules.py --summary` | 검증 통과, 15개 규칙. P0 6 / P1 6 / P2 3 |

주의: `build_rules.py`는 gitignore 대상인 `rules/dark_pattern_rules.json`을 생성한다(코드 변경 아님). 프론트 테스트(`npm test`)와 E2E는 이번에 실행하지 않았다.

### 4.2 Rule Engine 단독 평가 — **재측정값**

저장소를 오염시키지 않으려고 `backend/ ai/ rules/ data/`를 스크래치패드로 복사해 거기서 실행했다(`data/generator`로 HTML 생성 → `extract_ui.py --all` → `eval_rule_engine.py`). 저장소의 `docs/eval/rule_engine_report.json`은 건드리지 않았다. 결과 JSON은 `generated_at`을 제외하고 커밋된 리포트와 **완전히 동일**했다.

| 유형 | TP | FP | FN | P | R | F1 |
| --- | --- | --- | --- | --- | --- | --- |
| DA-03 | 3 | 0 | 0 | 1.00 | 1.00 | 1.00 |
| DA-04 | 4 | 18 | 0 | 0.18 | 1.00 | 0.31 |
| DA-07 | 7 | 0 | 0 | 1.00 | 1.00 | 1.00 |
| DA-12 | 3 | 0 | 0 | 1.00 | 1.00 | 1.00 |
| DA-15 | 3 | 3 | 0 | 0.50 | 1.00 | 0.67 |
| **micro** | 20 | 21 | 0 | **0.4878** | **1.00** | **0.6557** |
| macro F1 | | | | | | 0.7949 |

추가 관찰(오늘 출력에서 계산): clean 11개 flow **전부(11/11)** 에서 FP가 1건씩 나온다(DA-04 사전선택 체크박스가 clean에서도 검출). flow 단위 FPR로 보면 100%이며, 이것이 Hybrid의 LLM 검증 단계가 필요한 이유다. 체크 구현 현황: 선언 55개 중 11개.

---

## 5. Hybrid 평가 — 실행 보류, 승인 필요

### 5.1 예상 호출 수

| 구성 | 분석 호출 | 비고 |
| --- | --- | --- |
| 전체 (`--runs 3`, 22 flow) | **최소 66 / 일반 약 75~80 / 최대 132** + 위치 선택 호출 | 근거: `max_attempts=2`(`baseline.py:31,38`). 이전 luna 실측은 run당 25~26회 시도(재시도 3~4회) |
| 빠른 확인 (`--runs 1`, 22 flow) | 22 ~ 26 (최대 44) | 판정·위치 확인용 |
| 최소 (`--runs 1 --flows ins-001-risky,ins-002-risky`) | 2~4 | 연결·설정 점검용 |
| 위치 선택(grounding) | DA-03/DA-04 semantic finding마다 +1 | 건수는 코드만으로 확정 불가 [추정: 소수] |
| temperature 거부 모델 | 인스턴스당 +1 | `openai_provider.py:70-90` |

호출 1회 = 화면 5장을 `detail:high`로 전송 + 프롬프트(`openai_provider.py:~113`).

### 5.2 대략 비용 — **단가 확인 필요**

이전 리포트의 `model_cost_usd_per_screen`은 `null`이라 실측 비용 기록이 없다. 호출당 입력 약 10~20k 토큰(이미지 5장+프롬프트), 출력 약 1~3k 토큰으로 잡으면 **전체 3회 실행은 입력 약 1M·출력 약 0.15M 토큰 규모** [추정]. `gpt-5.6-luna`의 현재 단가는 이 조사에서 확인하지 못했으므로 달러 환산은 단가 확정 후 계산한다(예: 입력 $2/M·출력 $8/M이라 **가정**하면 약 $3~4 [추정]). 처음엔 `--runs 1`로 시작하는 것을 권한다.

### 5.3 실행 명령 (승인 후)

저장소 리포트 보존을 위해 **복사본에서 실행**하는 것을 권장한다(원본 `docs/eval/hybrid_report*.json`이 덮어쓰기 되므로).

```bash
# 0) 사전: Tesseract(kor+eng) 설치, .env 또는 환경변수에 OPENAI_API_KEY / DARKAUDIT_MODEL
# 1) 스크래치패드 복사본에서 데이터 생성
cd <copy>/data/generator
for c in configs/*.json; do python generate.py --config $c; python capture.py --config $c; done
python extract_ui.py --all
# 2) 1회 스모크
cd <copy>/backend && python eval_hybrid.py --runs 1 --flows ins-001-risky,ins-002-risky
# 3) 승인 시 전체
python eval_hybrid.py --runs 3
python compare_eval.py
```
`capture.py`가 라벨을 재생성해 정답이 달라질 수 있으므로(복사본에서만) 실행 후 라벨 diff를 확인한다 [추정].

### 5.4 승인이 필요한 사항
1. 실행 범위: 스모크(2 flow) → 1 run → 3 runs 중 어디까지
2. 사용할 모델(`DARKAUDIT_MODEL`)과 예산 상한
3. `OPENAI_API_KEY` 제공 방식(.env 또는 환경변수) — 키는 이 대화에 붙여 넣지 않는 것을 권장
4. Tesseract 설치 허용(PC 환경 변경)
5. 복사본 실행(권장) vs 저장소 `docs/eval/` 덮어쓰기

---

## 6. 재측정 결과 입력 템플릿

차이 = 재측정값 − 이전값. 값은 소수 4자리.

### 6.1 Rule Engine 단독 (집계 단위: rule×screen)

| 지표 | 이전값 (2026-09-06, `1595a75`) | 재측정값 (2026-10-02, `614bc1a`) | 차이 |
| --- | --- | --- | --- |
| micro Precision | 0.4878 | 0.4878 | 0.0000 |
| micro Recall | 1.0000 | 1.0000 | 0.0000 |
| micro F1 | 0.6557 | 0.6557 | 0.0000 |
| macro F1 | 0.7949 | 0.7949 | 0.0000 |
| DA-03 F1 | 1.0000 | 1.0000 | 0.0000 |
| DA-04 F1 (P 0.1818) | 0.3077 | 0.3077 | 0.0000 |
| DA-07 F1 | 1.0000 | 1.0000 | 0.0000 |
| DA-12 F1 | 1.0000 | 1.0000 | 0.0000 |
| DA-15 F1 (P 0.5) | 0.6667 | 0.6667 | 0.0000 |
| clean flow 오탐 flow 비율 | (미산출) | 11/11 | — |

### 6.2 Hybrid (집계 단위: flow 내 규칙 존재) — 3 runs × 22 flow

재측정값(gpt-6-luna)은 3회 평균이고 괄호는 min~max다. 차이 = 재측정값 − 이전 luna(gpt-5.6-luna). **|차이| ≥ 0.05는 굵게** 표시했다.

| 지표 | 이전 luna (gpt-5.6-luna, 09-06, `88a3057`) | 이전 mini (참고) | **재측정값 (gpt-6-luna, 2026-10-02, `614bc1a`)** | 차이(vs 5.6-luna) |
| --- | --- | --- | --- | --- |
| micro Precision | 1.0000 | 0.3975 | 0.8928 (0.7692~1.0000) | **−0.1072** |
| micro Recall | 0.6250 | 1.0000 | 0.6250 (0.6250~0.6250) | 0.0000 |
| micro F1 | 0.7692 | 0.5687 | 0.7332 (0.6897~0.7692) | −0.0360 (run1만 **−0.0795**) |
| macro P / R / F1 | 0.6 / 0.6 / 0.6 | (미확인) | 0.6 / 0.6 / 0.6 | 0 |
| DA-03 P / R | 0 / 0 (TP0 FN3) | 1 / 1 | **P 0 / R 0** (TP0 FN3, FP 3·0·1) | R 0.0000 (FP 증가) |
| DA-04 P / R | 1 / 1 (TP4) | 0.211 / 1 | 1 / 1 (TP4) | 0 |
| DA-07 P / R | 1 / 1 (TP3) | TP3, FP8~12 | 1 / 1 (TP3) | 0 |
| DA-12 P / R | 1 / 1 (TP3) | 1 / 1 | 1 / 1 (TP3) | 0 |
| DA-15 P / R | 0 / 0 (TP0 FN3) | 1 / 1 | 0 / 0 (TP0 FN3) | **R 0.0000** |
| instance_detection micro P | 1.0000 | (미확인) | 0.9153 (0.8125~1.0000) | **−0.0847** |
| instance_detection micro R | 0.8235 | (미확인) | 0.8039 (0.7647~0.8235) | −0.0196 |
| instance_detection micro F1 | 0.9032 | (미확인) | 0.8554 (0.7879~0.9032) | **−0.0478**(run1 −0.1153) |
| 위치 mean IoU / success_rate (IoU 0.5, 17건) | 0.8235 / 0.8235 | success 1.0, 1.0, 0.941 | 0.8039 / 0.8039 (0.7647~0.8235) | −0.0196 (run1 −0.0588) |
| Counterfactual 일관성 | 0.8909 (49/55) | 0.709, 0.70, 0.673 | 0.8727 (47·49·48 / 55) | −0.0182 |
| 반복 일관성(F1 min~max) | 0.7692~0.7692 (3회 동일) | 0.5424~0.5818 | 0.6897~0.7692 (run별 0.6897 / 0.7692 / 0.7407) | 변동 있음 |
| 평균 응답 시간(초/flow) | 21.2 (20.2~22.4) | 5.7~5.9 | **36.1** (34.4~38.0) | **+14.9 (+70%)** |
| 스키마 재시도율 | 0.12~0.154 | 0.045~0.083 | 0.1538 ×3 (run당 4 flow) | ≈ 0 |
| 비용/화면(USD) | null(미기록) | null | **약 $0.00096** (총 $0.316 ÷ 330화면) | 비교 불가 |
| 실제 LLM 호출 수 | (미기록) | (미기록) | 86회 (성공 82 + temperature 거부 4) | — |

> mini 열은 근거 검증 도입 전이라 참고용이다. 위치 지표는 OCR 조건이 달라 직접 비교가 안 될 수 있다(§6.3).

#### 차이 ≥ 0.05인 지표의 원인 후보
1. **Precision −0.107 / F1 run1 −0.080**: DA-03 오탐이 **clean flow에서만** 나왔다(run1: ins-002-clean·ins-003-clean·ins-009-clean 3건, run3: ins-006-clean 1건, run2: 0건). 같은 flow에서도 run마다 달라지는 비결정성이다. 후보 원인: (a) gpt-6-luna는 `temperature=0`을 받지 않아 temperature 없이 호출된다(`openai_provider.py:81-87`). 5.6-luna 이전 측정이 3회 완전히 같았던 것과 대비된다 [추정: 5.6-luna는 temperature를 받았는지 이번에 확인하지 않음]. (b) 5.6-luna에서는 DA-03 후보가 계약 검증을 통과하지 못해 사라졌는데, 이번에는 일부가 통과했다 [추정].
2. **instance P/F1 하락, 위치 run1 −0.059**: 위 DA-03 오탐 3건이 instance FP로 그대로 잡혔다(run1 FP 3). 오탐을 제외하면 위치 일치 TP는 13~14/17로 run2·3은 이전과 같다. 즉 위치 보정 자체가 나빠졌다기보다 오탐과 run1 TP 1건 감소가 원인이다.
3. **응답 시간 +70%**: §7.1 참조.
4. **DA-03·DA-15 재현율 0 유지**: 모델이 바뀌어도 변하지 않았다. 원인은 §7.2 참조.

### 6.3 실행 메타

| 항목 | 값 |
| --- | --- |
| 측정 일시 | 2026-10-02 (스모크 → 3 runs) |
| 커밋 해시 | `614bc1a` (저장소 변경 없이 스크래치패드 복사본에서 실행) |
| 모델 / provider | **gpt-6-luna** / openai (`DARKAUDIT_MODEL`은 환경변수로만 지정, 저장소 기본값·`render.yaml` 미변경). 모델 ID는 `/v1/models`에 `gpt-6-luna`로 존재 확인 |
| temperature | 거부됨(400 `Unsupported parameter: 'temperature'`). `_rejects_temperature` 로직이 동작해 파이프라인 인스턴스당 1회 거부 후 생략하고 재호출 (총 4회) |
| OCR | **켬** — Tesseract 5.5.3, kor+eng. `bbox_localizations` 8건 모두 OCR 앵커 1개 이상, `ocr_evidence_unavailable` 경고 0건. **이전 측정의 OCR 조건은 확인 불가**(리포트·예측 원본에 기록 없음). 따라서 위치 지표(IoU) 비교는 조건 일치가 보장되지 않는다 |
| 데이터셋 | 22 flow / 110 화면, 라벨은 재생성 전후 diff 없음(동일) |
| 호출 수 | 총 86회 = 분석 78(66 flow + 계약 재시도 12) + 위치 선택 4 + temperature 거부 4. 스모크 5회 포함(스모크 2 flow는 run-1에 재사용되어 중복 호출 없음) |
| 토큰 | 입력 1,893,070 / 출력 253,379 (추론 토큰 127,613 = 기록된 78회 출력의 52.9%) |
| 비용 | **$0.316** (입력 $0.10/M, 출력 $0.50/M 기준). 예산 상한 $2·$8 모두 미달 |
| 단가 확인 | 공식 모델 페이지 `developers.openai.com/api/docs/models/gpt-6-luna`에서 **대조 완료**: 입력 $0.1, 캐시 입력 $0.01, 출력 $0.5 (Standard, /1M). 추론 토큰이 출력으로 과금되는지는 페이지에 명시가 없어 `output_tokens`에 포함된 값을 출력 단가로 계산했다(OpenAI 응답 관례) [추정] |
| 저장 위치 | 복사본 `docs/eval/hybrid_report.gpt-6-luna.json`. 저장소 `docs/eval/`은 변경 없음 |
| 호출 수 상한 | 이전 지시의 40회 상한은 모델 변경 지시로 대체됨. 예산 가드(누적 $1.9)는 발동하지 않음 |

### 6.4 모델 비교표 (`compare_eval.py` 출력)

| model | F1 평균(범위) | P | R | 지연(s) | 재시도 | 위치 |
| --- | --- | --- | --- | --- | --- | --- |
| gpt-5.4-mini | 0.569 (0.54~0.58) | 0.40 | 1.00 | 5.9 | 8% | 1.00 |
| gpt-5.6-luna | 0.769 (0.77~0.77) | 1.00 | 0.62 | 22.4 | 15% | 0.82 |
| gpt-6-luna | 0.733 (0.69~0.77) | 0.89 | 0.62 | 35.9 | 15% | 0.76 |

| 규칙(F1) | gpt-5.4-mini | gpt-5.6-luna | gpt-6-luna |
| --- | --- | --- | --- |
| DA-03 | 1.00 | **0.00** | **0.00** |
| DA-04 | 0.35 | 1.00 | 1.00 |
| DA-07 | 0.43 | 1.00 | 1.00 |
| DA-12 | 1.00 | 1.00 | 1.00 |
| DA-15 | 1.00 | **0.00** | **0.00** |

(`compare_eval.py`의 지연·위치 열은 마지막 run 또는 최댓값 기준이라 §6.2의 3회 평균과 소수점이 다를 수 있다 [추정]. mini의 DA-03·DA-15 F1 1.00은 근거 검증 도입 전 값이다.)

---

## 7. 모델 변경(gpt-6-luna)으로 달라진 점과 추가 분석

### 7.1 응답 시간이 길어진 이유 (평균 21.2초 → 36.1초)
| 요인 | 관찰 |
| --- | --- |
| 재시도 | 계약 재시도는 **매 run 같은 4개 flow**(dep-001-risky, ins-001-risky, ins-002-risky, ins-007-risky)에서만 발생. 재시도 flow 평균 63.0초 vs 1회 통과 flow 30.1초. 재시도를 없애면 평균 약 6초(−17%) 단축. **재시도율(0.1538)은 5.6-luna(0.12~0.154)와 같아** 지연 증가의 원인은 아니다 |
| 추론 토큰 | 기록된 78회 호출의 출력 토큰 중 **52.9%가 추론 토큰**(127,613 / 241,362) |
| reasoning effort 설정 | **코드에 설정이 없다**(`openai_provider.py`·`baseline.py`에서 `reasoning`/`effort` grep 0건). 공식 페이지상 지원 값 `none/low/medium/high/xhigh/max`, 기본 `medium`이므로 기본값 medium으로 동작 중 |
| 5.6-luna의 추론 토큰량 | 이전 측정에 기록이 없어 비교 불가 [추정: 모델당 호출 지연이 늘어난 주원인이 추론량일 가능성] |

**제안(코드는 바꾸지 않았다)**: `OpenAIResponsesProvider._create`(`openai_provider.py:70-87`)가 넘기는 `responses.create` 인자에 `reasoning={"effort": "low"}`를 환경변수(예: `DARKAUDIT_REASONING_EFFORT`)로 주입할 수 있게 하고, 같은 22 flow로 재측정해 DA-04·07·12 재현율이 유지되는지 확인한다. 비용도 함께 줄어든다(출력의 절반이 추론). 재시도 자체를 줄이려면 §7.2의 계약 문제를 먼저 고쳐야 한다.

### 7.2 schema_attempts = 2의 원인
- `schema_attempts`는 `baseline.py:98-128`의 루프 횟수로, **증거 계약 검증(EvidenceContractError) 실패 시에만** 늘어난다. temperature 거부 재시도는 `_create` 내부에서 처리되어(`openai_provider.py:81-87`) **카운트에 섞이지 않는다**. 스모크의 두 flow(ins-001-risky, ins-002-risky)는 모두 재시도 대상 flow였을 뿐이다.
- 실제 사유(`rejected_evidence`, dep-001-risky 예): `DA-03 KEEP must verify the candidate's actual opposing actions`, `DA-15 requires structured initial/final price evidence`. 두 번째 시도에서도 실패하면 `evidence_recovery`가 해당 항목을 제외한다(`baseline.py:115-121`).
- 이 4개 flow는 DA-03·DA-15 정답이 있는 flow이고, **5.6-luna도 재시도 횟수가 같다(run당 3~4건)**. 따라서 DA-03·DA-15 재현율 0은 모델이 아니라 **프롬프트/증거 계약 쪽 문제**일 가능성이 크다 [추정, 두 모델에서 동일하게 재현]. 개선 포인트: `ai/prompts/audit_v1.md`의 DA-03 choice_pairs·DA-15 price_comparisons 작성 지침, `assessment_contract.py:105-243`.
- temperature 거부 호출은 총 4회(스모크 1 + 3 runs 각 1)로 실패 응답이라 시간·비용 영향이 거의 없다.

### 7.3 모델 교체 시 주의
- 이번 결과로는 gpt-6-luna가 5.6-luna보다 낫다고 말할 근거가 없다: 재현율 동일, 정밀도·위치 소폭 하락(오탐 비결정성), 지연 +70%. 단가가 낮아(회당 약 $0.001/화면) 비용 이슈는 없다.
- `DARKAUDIT_MODEL` 기본값과 `render.yaml`은 변경하지 않았다. 교체는 결정 후 별도 진행.
- 표본이 작다: DA-03·15 정답이 각 3건뿐이고 flow 22개라 한 건 변화가 0.05 이상의 지표 변동을 만든다.

---

## 8. 측정 방식 변경 (평가 스크립트 결함 수정)

> **요약**: DA-03·DA-15 재현율 0은 모델·프롬프트·증거 계약의 문제가 아니라 **평가 스크립트(`backend/eval_hybrid.py`)가 계약이 요구하는 후보 `evidence`를 만들지 않던 결함** 때문이었다. 수정 후 gpt-5.6-luna의 재현율이 0.625 → 0.979로 올랐다. 이 변화는 모델 성능이 아니라 **측정 방식이 바로잡힌 결과**이며, §3·§6.2의 이전 DA-03/DA-15 수치(5.6-luna·6-luna 모두)는 결함이 있는 측정이다. §7.2의 "프롬프트/증거 계약 쪽 문제일 가능성" 추정은 틀렸고 이 절이 정정한다.

### 8.1 결함 기록
| 항목 | 내용 |
| --- | --- |
| 결함이 생긴 커밋 | `57ec857` (2026-09-06, "fix: repair analysis pipelines and enforce evidence contracts") — 운영 경로 `ai/pipeline/rule_candidates.py:61-102`에는 `measurements.evidence`를 추가했지만 평가 스크립트 `backend/eval_hybrid.py`의 `candidates_for`는 갱신하지 않았다 |
| 원인 | 증거 계약(`ai/pipeline/assessment_contract.py:112-127` DA-03, `:230-243` DA-15)은 모델이 쓴 `accept_text`/`decline_text`/가격 근거를 후보의 `measurements.evidence`(요소 텍스트·화면)와 대조한다. 평가 후보에는 이 필드가 없어 **DA-03·DA-15를 KEEP하면 항상** `EvidenceContractError`로 탈락 → `evidence_recovery`가 항목을 버림 |
| 증상 | DA-03·DA-15 재현율 0(5.6-luna, 6-luna 모두), 해당 4개 flow에서 매 run 스키마 재시도(`schema_attempts=2`) |
| 확인 방법 | 4개 flow의 모델 원본 응답 8건을 캡처해 `choice_pairs`·`price_comparisons` 필드가 모두 올바름을 확인 → 후보에 evidence를 넣고 오프라인 재검증하면 8건 모두 첫 시도 통과. 모델 주장을 일부러 틀리게 바꾼 3건(DA-03 거절 문구 불일치, DA-15 금액 증가 없음, DA-15 초기 고지됨)은 evidence가 있어도 계속 탈락 → **계약을 완화하지 않았고 근거 없는 탐지가 통과하지 않는다** |
| 수정 | 브랜치 `fix/da03-da15-contract`, 커밋 `693c2a1`. `candidates_for`가 운영 경로의 `run_artifact_rules`/`candidate_payload`를 재사용(`backend/eval_hybrid.py` `candidates_from_ui`). 프롬프트·계약·운영 코드는 변경 없음 |
| 부수 수정 1 | 같은 `element_id`가 여러 화면에 반복되면(예: 동의 문구) 기존 평가는 마지막 화면의 bbox를 썼다. 요소 사전 키를 `(screen_index, element_id)`로 바꿈. 영향: ins-001/003/009-risky의 DA-04 후보 1건이 올바른 화면(screen-02)에 매핑됨 |
| 부수 수정 2 | `candidate_payload`는 같은 체크가 두 번 기록되면 `triggered_checks`를 중복으로 내보내 `RuleCandidate`가 거부한다. 평가 쪽에서 중복 제거 |
| 테스트 | `backend/tests/test_eval_hybrid_candidates.py` 9개(모두 통과): 후보에 evidence가 비면 실패, 운영 payload와 키·candidate_id 형식 동일, 저장한 8개 응답이 첫 시도에 통과, evidence를 비우면 같은 응답이 탈락. 전체 `backend/tests` 102개·`ai/tests` 106개 통과 |

### 8.2 이전 수치 vs 새 수치 (gpt-5.6-luna, 3 runs × 22 flow, OCR 켬)

이전 = `88a3057` 시점 리포트(결함 있는 평가). 새 = 수정 후 복사본 실행(`614bc1a` + `693c2a1`). **이 표의 차이는 모델 변화가 아니라 측정 방식 변경이다.** |차이| ≥ 0.05는 굵게.

| 지표 | 이전 (결함 있음) | 새 (수정 후) | 차이 |
| --- | --- | --- | --- |
| micro Precision | 1.0000 | 0.9400 (0.9375~0.9412) | **−0.0600** |
| micro Recall | 0.6250 | 0.9792 (0.9375~1.0000) | **+0.3542** |
| micro F1 | 0.7692 | 0.9590 (0.9375~0.9697) | **+0.1898** |
| macro P / R / F1 | 0.6 / 0.6 / 0.6 | 0.950 / 0.978 / 0.958 | **+0.35 / +0.38 / +0.36** |
| DA-03 P / R | 0 / 0 (TP0 FN3) | **0.75 / 1.00** (TP3 FP1 FN0, 3회 동일) | **R +1.00** |
| DA-04 P / R | 1 / 1 | 1 / 1 | 0 |
| DA-07 P / R | 1 / 1 | 1 / 1 | 0 |
| DA-12 P / R | 1 / 1 | 1 / 1 | 0 |
| DA-15 P / R | 0 / 0 (TP0 FN3) | **1.00 / 0.889** (run별 TP 3·2·3, FP 0) | **R +0.89** |
| instance_detection micro P / R / F1 | 1.0000 / 0.8235 / 0.9032 | 0.8230 / 1.0000 / 0.9028 (※) | **P −0.177**, **R +0.177**, 0 |
| 위치 mean IoU / success_rate (IoU 0.5, 17건) | 0.8235 / 0.8235 | 1.0000 / 1.0000 (17/17, 3회 모두) (※※) | **+0.1765** |
| Counterfactual 일관성 | 0.8909 (49/55) | 0.9758 (54·53·54 / 55) | **+0.0849** |
| 반복 일관성(F1 min~max) | 0.7692~0.7692 | 0.9375~0.9697 | 변동 폭 0.032 |
| 평균 응답 시간(초/flow) | 21.2 (20.2~22.4) | 19.5 (18.9~20.6) | −1.7 (−8%) |
| 스키마 재시도율 | 0.12~0.154 (평균 0.139, run당 3~4건) | 0.000 / 0.083 / 0.000 (평균 0.028, 3 runs 합계 2건) | **−0.111** |
| 비용/화면(USD) | null | 약 $0.0015 (총 $0.494 ÷ 330화면, 5.6-luna 단가 입력 $0.2·출력 $1.2/M) | 비교 불가 |

※ `instance_detection`은 bbox가 있는 라벨만 대조한다(`evaluator.py:126-136`). DA-15는 flow 단위 라벨(bbox 없음)이라 **DA-15 탐지가 모두 FP로 집계되는 평가기 특성**이 있다(run당 FP 2~3). 이전에는 DA-15 탐지가 없어 이 항목이 0이었다. DA-15를 제외한 4개 규칙만 보면 TP 17 / FP 1 / FN 0 → P 0.944, R 1.000, F1 0.971이다.
※※ 이 flow들의 DA-03·DA-04·DA-07·DA-12 탐지는 **Rule Engine 후보 요소의 bbox**를 그대로 쓰므로 정답 라벨과 IoU가 1.0이 된다. 이전의 0.8235는 DA-03 3건이 탐지되지 않아 낮았던 것이다. DOM이 없는 스크린샷 입력의 위치 정확도(OCR/CV 보정)를 대표하지 않는다. 이전 측정 OCR 조건은 확인 불가이므로 위치 지표의 직접 비교 한계는 §6.3과 같다.

### 8.3 합격 기준 확인
| 기준 | 결과 |
| --- | --- |
| DA-04·07·12 성능 유지 | **유지**. 3 runs 모두 TP 4·3·3, FP 0, FN 0 |
| DA-03·DA-15 재현율 | DA-03 1.00, DA-15 0.889 (run2 dep-001-risky에서 모델이 DA-15를 KEEP하지 않아 1건 미탐. 같은 flow에서 모델이 시도마다 KEEP/REJECT를 달리하는 변동이 원본 응답 캡처에서도 확인됨) |
| clean flow 오탐 | **DA-15: 0건**(33 clean flow-run). **DA-03: 2건**(ins-001-clean run1, ins-005-clean run3; LLM 단독 semantic finding, `screen-05` CTA 주변 bbox). 라벨 없는 risky flow의 DA-03 오탐 1건(ins-009-risky run2)도 있음. DA-04·07·12 clean 오탐 0건. clean flow-run 기준 flow 단위 규칙 FPR = 2 / (33×5) = 1.2%, DA-03만 보면 2/33 = 6.1% |
| 스키마 재시도율 0에 가까워짐 | **달성**: 평균 0.139 → 0.028 (66 flow-run 중 2건). 이전에 매 run 재시도되던 4개 flow는 모두 1회 통과 |
| 평균 응답 시간 감소 | **소폭 감소**: 21.2초 → 19.5초(−8%). 재시도 flow가 사라진 효과가 평균에 비해 작다 |

### 8.4 펫보험 시연 흐름 (스크린샷 6장, `frontend/public/sample-audit/`)
업로드 경로와 같은 설정(`allow_visual_fallback=True`, 후보 없음, OCR 켬, `batch_indices` 5장 + 컨텍스트 3장 2배치)으로 gpt-5.6-luna를 2회 실행(16호출, $0.064).

| run | DA-15 | 비교한 금액 | 비고 |
| --- | --- | --- | --- |
| 1 | **detected** (screen-01 → screen-06, 신뢰도 0.93) | 12,900 → **19,000원** | 19,000원은 선택 특약 포함 금액이라 데모 설계(필수 비용만: 12,900→14,000)와 비교 기준이 다름. `explained_by_user_choice=false`로 기록됨 |
| 2 | **detected** (신뢰도 0.97) | 0 → **1,100원** ("필수 계약 관리비") | 데모 설계의 필수 비용 후공개와 일치 |

- 두 번 모두 DA-15가 탐지로 나왔다. 다만 첫 배치(화면 1~5)는 두 번 다 재시도(attempts 2, 79~83초)가 있었고 run 2는 DA-03이 증거 계약으로 탈락했다(`evidence_contract:DA-03`). 선택 비용과 필수 비용을 구분하는 일관성은 run 1에서 흔들렸으므로 시연 시 재확인이 필요하다.
- 이 경로는 후보 없는 LLM 단독 경로라 이번 평가 스크립트 수정과 무관하다.

### 8.5 실행 메타
| 항목 | 값 |
| --- | --- |
| 모델 | gpt-5.6-luna (`DARKAUDIT_MODEL` 기본값·`render.yaml` 미변경). 공식 단가 입력 $0.2 · 캐시 $0.02 · 출력 $1.2 /1M(`developers.openai.com/api/docs/models/gpt-5.6-luna` 대조) |
| 호출 수 | 검증 75회(스모크 5 포함; 성공 71 + temperature 거부 4) + 펫보험 16회 + 원인 분석용 원본 캡처 8회 |
| 비용 | 검증 $0.494 + 펫보험 $0.064 = **$0.558** (예산 $1.5), 원인 분석 캡처 약 $0.059 별도 |
| 정정 | gpt-5.6-luna도 `temperature` 파라미터를 **거부한다**(파이프라인 인스턴스당 1회 거부 후 생략). 따라서 §7 원인 후보 (a)의 "6-luna만 temperature 미적용이라 비결정적"이라는 추정은 성립하지 않는다. 6-luna의 DA-03 오탐 변동은 이번 수정 전 측정이므로 재측정이 필요하다 |
| gpt-6-luna | §6.2의 gpt-6-luna 수치도 같은 결함 하의 측정이다. 모델 비교가 필요하면 수정된 스크립트로 재측정해야 한다(약 $0.3) |
| 저장소 영향 | `backend/eval_hybrid.py`, `backend/tests/test_eval_hybrid_candidates.py`, `backend/tests/fixtures/eval_hybrid/`(원본 응답 8건) 추가·수정만. `docs/eval/` 원본 리포트는 변경 없음(재측정 리포트는 스크래치패드 복사본) |

### 8.6 운영 경로 후보 payload 결함 — 수정 완료 (`fcb0c88`)
- `candidate_payload`(`ai/pipeline/rule_candidates.py`)가 `triggered_checks` 중복을 제거하지 않아, 같은 `element_id`의 요소가 한 화면에 반복되면 `RuleCandidate`가 `triggered_checks must be unique`로 거부했다(평가 데이터 ins-001/003/009-risky에서 재현). 순서를 유지하며 중복을 제거하도록 수정하고, 평가 스크립트의 임시 중복 제거는 걷어냈다.
- 테스트 `ai/tests/test_rule_candidates.py` 2개 추가. **수정 전 코드에서는 실패하고 수정 후 통과**함을 확인했다. 전체 `ai/tests` 108개·`backend/tests` 102개 통과.
- **웹 데모(roam)는 이 결함을 맞지 않았다**: 모바일 6화면(DOM 22·19·16·13·12·21개)을 스크립트로 순회 캡처해 서비스와 같은 함수(`prepare_analysis_artifacts` → `analysis_batches` → `run_artifact_rules` → `candidate_payload` → `RuleCandidate`)를 통과시킨 결과, 수정 전·후 모두 후보 스키마 오류 0건이었다(도메인 DOM에서 같은 id가 반복되지 않음; `prepare_analysis_artifacts`가 이미지별로 DOM 식별자를 분리). 따라서 이번 수정은 시연 흐름을 직접 고친 것이 아니라 **다른 입력에서의 분석 실패를 막는 예방 수정**이다.
- 이 확인의 한계: 실제 URL 데모는 스마트 탐색(Computer Use)으로 클릭 이동하지만, 여기서는 `?step=1..6`을 순서대로 열어 같은 화면을 얻었다. Computer Use 탐색 자체는 실행하지 않았다.

### 8.7 웹 데모(roam) 분석 결과 (gpt-5.6-luna, 5호출, $0.025)
| 배치 | 재시도 | 결과 |
| --- | --- | --- |
| 화면 1~5 | 1회 통과 (29초) | DA-04·DA-07·DA-12 detected(KEEP 9건), DA-03 not_detected, DA-15 insufficient_evidence |
| 화면 1·5·6 | 2회 (60초, `evidence_contract:DA-03` 경고) | DA-04·DA-07·DA-12 detected, **DA-15 detected(최종 화면 KEEP)**, DA-03 insufficient_evidence |
- 분석은 정상 완료되고 DA-15가 최종 화면에서 탐지된다. 다만 데모 설계에 있는 DA-03(수신/거절 위계 차이)은 Rule Engine이 대립 쌍 후보를 만들지 못해 탐지되지 않았다(DOM 모드는 DA-03 신규 finding을 `optional_looks_mandatory`로만 허용, `ai/prompts/dom.md:3-4`). 시연에서 DA-03을 보여주려면 사전 점검이 필요하다.

---

## 9. 발표용 수치 (수정된 평가 기준, gpt-5.6-luna, 3회 평균, 22 flow)

집계 방식은 이전 슬라이드와 같다: **flow 안에서 규칙이 있는지 여부**(`Evaluator.evaluate_dataset`)로 세고, 검토 대상 = 실제 문제 + 오탐이다. 정답은 flow-규칙 16건(DA-03·04·12·15 각 3~4건, DA-07 3건). 평가기는 같은 `Evaluator`를 썼다.

### 9.1 검토 대상 / 실제 문제 / 오탐 / 놓친 문제
| 구분 | 검토 대상 | 실제 문제 | 오탐 | 놓친 문제 |
| --- | --- | --- | --- | --- |
| Rule Engine 단독 | **34** | 16 | 18 | 0 |
| Hybrid run 1 / 2 / 3 | 17 / 16 / 17 | 16 / 15 / 16 | 1 / 1 / 1 | 0 / 1 / 0 |
| **Hybrid 3회 평균** | **16.7** | **15.7** | **1.0** | **0.3** |
| (참고) 이전 슬라이드 Rule Engine | 35 | 16 | 19 | 0 |
| (참고) 이전 슬라이드 Hybrid(결함 있는 평가) | 10 | 10 | 0 | 6 |

- Rule Engine이 이전 슬라이드(35·16·19·0)와 1건 다르다(오탐 18). 같은 데이터·같은 `Evaluator`로 재계산한 값이며, 이전 값은 `6d25907` 이전 상태이거나 다른 집계였을 가능성이 있다 [추정]. **슬라이드에는 34·16·18·0을 쓰길 권한다.**
- Hybrid의 이전 값 10·10·0·6은 §8의 평가 결함으로 DA-03·DA-15가 빠진 측정이다. 같은 구조(오탐 약 18건이 1건으로)로 요약하면 "Rule Engine이 34건을 검토 대상으로 올리면 Hybrid는 17건으로 줄이면서 놓친 문제는 0~1건".

### 9.2 Hybrid 정밀도·재현율·F1 (micro, 3회 평균; 괄호는 최소~최대)
| 지표 | 값 |
| --- | --- |
| Precision | **0.940** (0.938~0.941) |
| Recall | **0.979** (0.938~1.000) |
| F1 | **0.959** (0.938~0.970) |
| (참고) Rule Engine 단독 flow 단위 | P 0.471 / R 1.000 / F1 0.640 |

### 9.3 유형별 (Hybrid, 3회 평균)
| 유형 | Precision | Recall | 비고 |
| --- | --- | --- | --- |
| DA-03 잘못된 계층구조 | 0.75 | 1.00 | clean flow 오탐 2회(LLM 단독 finding) + 무라벨 risky 1회 |
| DA-04 사전선택 | 1.00 | 1.00 | Rule Engine 단독 P 0.21 → 오탐 15건 제거 |
| DA-07 숨겨진 정보 | 1.00 | 1.00 | |
| DA-12 감정적 언어 | 1.00 | 1.00 | |
| DA-15 순차공개 가격 | 1.00 | 0.89 | run2 dep-001-risky 1건 미탐(모델 변동) |

### 9.4 일관성·응답시간
| 지표 | 값 |
| --- | --- |
| 판정 일관성(Counterfactual, risky/clean 쌍 11개) | **0.976** (54·53·54 / 55) — 이전 0.891 |
| 반복 일관성(3회 F1) | 0.938 / 0.970 / 0.970 (최대-최소 0.032). 비교: 3회 중 2회는 완전히 같은 결과 |
| 평균 응답 시간 | **19.5초/flow(5화면)** (18.9~20.6) |
| 스키마 재시도율 | 0.028 (66 flow-run 중 2건) |
| 비용 | 약 $0.0015/화면 (5.6-luna 입력 $0.2·출력 $1.2 /1M) |

### 9.5 정상(clean) flow 오탐률 (FPR = 오탐 / (오탐 + 정상 판정), flow-규칙 쌍 기준)
| 기준 | Rule Engine 단독 | Hybrid (3회 평균) |
| --- | --- | --- |
| clean flow만 (11 flow × 5규칙 = 55쌍) | **11/55 = 20.0%** (clean flow 11개 **전부**에서 오탐) | **0.67/55 = 1.2%** (run1·3에 DA-03 1건씩, run2 0건) |
| 전체 정상 쌍 (94쌍 = 110 − 정답 16) | 18/94 = 19.1% | 1/94 = 1.1% |
| 규칙별 | DA-04 15건, DA-15 3건 | DA-03만 해당 |

- 근거: `data/synthetic/labels`의 clean flow 11개(`labels: []`)와 위 평가. FPR 코드는 저장소에 없어 이 문서의 계산(§2 "FPR 코드 없음")으로 산출했다. 표본이 작다(clean 11 flow). 라벨은 생성기가 심은 패턴 기준이라 실제 금융 화면으로 일반화할 수 없다.
- 위치 지표는 이 표에서 뺐다. 현재 위치 정확도는 후보 요소 bbox를 그대로 쓰므로 §10 참조.

---

## 10. 위치 정확도 — 스크린샷(LLM 단독) 경로 측정 (1회 실행, gpt-5.6-luna)

`backend/eval_hybrid.py --runs 1 --visual`(후보 없이 `allow_visual_fallback=True`, 업로드 경로와 같은 설정, OCR 켬). 51호출(성공 50 + temperature 거부 1), **$0.203**(상한 $0.5). 결과는 복사본 `hybrid_report.visual.gpt-5.6-luna.json`(저장소 `docs/eval/` 미변경).

### 10.1 위치 정확도 (IoU 0.5, 정답 bbox가 있는 17건)
| 유형 | 적중 | 평균 최고 IoU | 비고 |
| --- | --- | --- | --- |
| DA-03 | **3/3** | 0.995 | CV 후보 보정 |
| DA-04 | **4/4** | 0.974 | 선택 컨트롤 보정 |
| DA-07 | **4/7** | 0.445 | ins-001·ins-004의 화면 5 정답은 IoU 0.0(다른 위치를 지목), dep-001 화면 2는 해당 화면에 탐지 없음 |
| DA-12 | **2/3** | 0.620 | dep-001 화면 5 IoU 0.32 |
| **합계** | **13/17 (76.5%)** | 평균 IoU 0.697 | 평가기 `localization.success_rate` 0.765와 일치 |

- 후보 bbox를 그대로 쓸 때의 1.000(§8.2)과 크게 다르다. **스크린샷 경로의 위치 정확도는 유형에 따라 갈린다**: 버튼·체크박스(DA-03·04)는 OCR/CV 보정으로 거의 일치하고, 글 덩어리(DA-07·12)는 어긋난다.
- 정답 bbox는 생성기가 HTML에서 추출한 값이다. 합성 화면이라 실제 금융 화면으로 일반화할 수 없다. 1회 측정이라 변동 폭은 모른다.

### 10.2 같이 드러난 점 — 후보 없는 LLM 단독은 오탐이 많다
| 지표 | 값 |
| --- | --- |
| flow 단위 P / R / F1 | **0.296 / 1.000 / 0.457** (TP 16, FP 38) |
| 유형별 오탐 | DA-03 19건, DA-07 19건(두 유형이 거의 모든 flow에서 탐지됨). DA-04·12·15는 오탐 0 |
| clean flow 탐지 | clean 11 flow에서 DA-03 11건·DA-07 17건 |
| Counterfactual 일관성 | 0.600 |
| 평균 응답 시간 / 재시도율 | 30.7초 / 8.3% |

- Rule Engine 후보 + LLM 검증(Hybrid, §9)은 P 0.94·오탐 약 1건이다. **즉 Hybrid의 정밀도는 Rule Engine 후보가 LLM 판단을 붙잡아 주는 효과가 크다.** DOM이 없는 스크린샷·Figma 업로드는 이 오탐 수준이 현재 현실이며, 슬라이드에 "스크린샷 경로 위치 정확도 76.5%"를 쓸 때는 오탐 수치와 함께 제시하는 것이 정직하다.
- 위치 적중은 "정답 위치에서 같은 유형을 찾았는가"만 본다. DA-03·DA-07처럼 거의 모든 화면에 탐지를 내는 경우 정답과 겹칠 확률이 높아 위치 수치가 낙관적일 수 있다(평가기는 1:1 매칭이라 TP는 13).

---

## 11. 웹 데모(roam) DA-03 미탐지 원인과 선택지

### 11.1 원인 (코드 기준)
- 후보 생성 `backend/app/rule_engine/checks.py:35-55` `_pair_of_options`는 ① 텍스트가 있는 버튼 2개, ② **세로 중심 차이 ≤ 0.05(나란한 배치)**, ③ 거절 쪽 라벨에 힌트 단어(`checks.py:32` `_DECLINE_HINT`: 않기·안함·취소·나가기·다음에·거절·포기·닫기)를 모두 요구한다.
- 데모 DOM 실측(화면 3·4·5): 수락 버튼 y 0.843·h 0.061, 거절 버튼 y 0.912·h 0.034 → 중심 차이 **0.0555 > 0.05**(위아래로 쌓인 레이아웃). 라벨도 "알림 없이 계속"·"저는 손해 보고 여행할게요"는 힌트 단어가 없고 "수신 거절 유지하고 계속"은 힌트는 있으나 배치 조건에서 탈락.
- DOM 입력에서는 LLM이 DA-03 `visual_hierarchy` finding을 새로 만들 수 없고 `optional_looks_mandatory`만 허용된다(`ai/prompts/dom.md:3-4`, `ai/pipeline/web_audit.py:127-130`). 후보가 없으면 DA-03은 `not_detected`/`insufficient_evidence`로 끝난다.

### 11.2 (a) 고치기 — 오프라인 시뮬레이션(LLM 호출 없음)
`_pair_of_options`를 바꿔 22개 합성 flow + 데모 3종(travel·pet·credit, 모바일 6화면)에 DA-03 후보가 어떻게 달라지는지 확인(저장소 코드 미변경, 임시 패치).

| 변형 | 합성 22 flow | 데모 travel(웹 데모) | credit |
| --- | --- | --- | --- |
| 현재 | risky 3개만(정답과 동일), clean 0 | 없음 | 없음 |
| 세로로 쌓인 버튼 허용 (x 겹침 ≥ 0.8, 간격 ≤ 0.05, 거절이 더 작음) | **변화 없음**(risky 3, clean 0) | 화면 5 | 화면 4 |
| 위 + 힌트 확장("없이"·"손해"·"유지하고") | 변화 없음 | 화면 3·4·5 | 화면 3·4 |

- 작업량 **S~M(약 0.5~1일)**: `checks.py` 약 15줄 + 단위 테스트 + 합성 22 flow 오프라인 회귀 + Hybrid 평가 1~3회(약 $0.2~0.5) + 데모 재확인.
- 위험: 실제 사이트에서 쌓인 보조 링크가 후보로 늘 수 있다(LLM이 KEEP/REJECT로 걸러냄). 힌트 단어 확장은 한국어 휴리스틱이라 "쌓인 배치 허용"만 먼저 넣는 것을 권한다. 정확도 효과는 합성 데이터에서는 변화 없음(오탐 증가도 없음)이라 **데모·실사이트 일반화 측면의 개선**이다.
- 코드 수정은 승인 후 진행.

### 11.3 (b) 시연에서 DA-03 제외
- 영향: 웹 데모는 DA-04·07·12·15가 탐지된다(§8.7에서 확인). DA-03은 P0 MVP 유형이지만 스크린샷 시연(펫보험)과 합성 평가에서는 탐지되므로 **발표 전체에서 DA-03이 사라지는 것은 아니다**(펫보험 run 1 탐지, run 2는 계약으로 탈락).
- 필요 작업: `demo/README.md`·데모 설명의 의도한 패턴 목록에서 DA-03 표기를 정리(S, 약 1시간). 엔진 위험 없음. 단점: "5개 지원 유형 중 4개"만 라이브로 보여 준다.
- (c) 데모 레이아웃을 나란한 버튼 + 힌트 라벨로 바꾸는 방법(S, 1~2시간)도 있으나 탐지기에 맞춰 화면을 고치는 것이라 발표 시 공개해야 한다.
- 권장: (a)의 "쌓인 배치 허용"만 적용(S). 시간이 부족하면 (b).

---

## 12. 펫보험 시연 DA-15 비교 금액이 달라지는 원인

- **입력 차이가 아니다**: 두 번 모두 같은 PNG 6장·같은 배치(`[1~5]`, `[1,5,6]`)·OCR(결정적)이었다. 달라진 것은 **LLM이 `price_comparisons`에 어떤 금액을 쓰느냐**다(gpt-5.6-luna는 `temperature` 고정이 불가, §6.3). 후보가 없는 스크린샷 경로라 금액이 코드가 아니라 모델 출력(`ai/prompts/audit_v1.md` "가격 근거")이다.
- 화면 06에는 기본 12,900 / 필수 관리비 1,100 / 선택 3,200 / 선택 1,800 / 최종 19,000이 모두 있고 각주에 "특약 제외 기본형 총액 14,000원"이 있다. run 1은 12,900→19,000(선택 포함 총액), run 2는 0→1,100(필수 관리비 항목)을 골랐다. 증거 계약은 방향·고지 플래그만 검증하고(`assessment_contract.py:206-215`) 선택 포함 여부는 모델이 쓴 `explained_by_user_choice`를 믿는다.
- **고정 방법 제안**(코드 수정은 승인 후):
  1. 프롬프트에 비교 기준 명시(S): "'선택' 표기·사용자가 추가한 항목은 제외하고 필수 비용(기본료+필수 수수료)끼리 초기/최종을 비교하며, 비교 금액의 항목명을 `product`에 적는다." 펫보험 5회 반복(약 $0.1)으로 일치율 확인. 완전 고정은 아님.
  2. 시연용 사전 실행 결과 저장(S): 같은 입력을 미리 분석해 저장된 진단을 열어 보이고 "사전 실행 결과"임을 밝힘. 라이브 실행은 보조로 둔다.
  3. 화면 설계(S~M): 최종 화면에 "필수 비용 합계 14,000원"을 별도 행으로 두면 모델이 고를 수 있는 후공개 금액이 하나로 모인다. 데모 화면을 탐지기에 맞추는 것이므로 공개 필요.
  4. 3회 합의(M, 비용 3배): 다수결로 금액 확정. 지연·비용 증가.
- 권장: 1 + 2.

---

## 13. Rule Engine 34 vs 35 — 확정

- **35·16·19·0은 Rule Engine 단독 값이 아니다.** 해당 수치는 `README.md` 설계 선택 표의 **"검증 완화" 하이브리드 설정**이다(`README.md:214-219`, 커밋 `88a3057` 2026-09-06 18:12). 같은 표의 "현재(근거 검증) 10·10·0·6"은 §8의 평가 결함이 있던 측정이다.
- Rule Engine 단독을 같은 flow-규칙 집계(`Evaluator.evaluate_dataset`)로 엔진 이력별로 재계산했다(같은 합성 데이터).

| 엔진 상태 | 검토 대상 | 실제 | 오탐 | 놓침 | 오탐 내역 |
| --- | --- | --- | --- | --- | --- |
| `7c59e76`·`57ec857`·`6d25907~1` (DA-07 수정 전) | 53 | 16 | 37 | 0 | DA-07 19, DA-04 15, DA-15 3 |
| `6d25907` 이후 = 현재 HEAD | **34** | 16 | **18** | 0 | DA-04 15, DA-15 3 |

- 어떤 엔진 상태에서도 35·19가 나오지 않는다. 따라서 35·16·19는 "검증 완화" 하이브리드 실행에서 Rule Engine 후보 34건 + LLM 추가 1건이 합쳐진 값으로 보이지만 [추정], 그 실행의 원본 예측이 저장소에 없어 **1건의 flow·규칙은 특정할 수 없다**. 확정 가능한 것: Rule Engine 단독은 **34·16·18·0**이다(오탐 18 = DA-04 15 + DA-15 3).
- 부수 발견: `README.md`의 "DA-03·DA-15는 근거 검증을 통과하지 못해 판정에서 제외됐다… 합성 스크린샷만으로는 모델이 확정하지 못했습니다" 서술은 §8의 평가 스크립트 결함 때문이었으므로 사실과 다르다(수정 필요, 이번에는 README를 고치지 않았다).
