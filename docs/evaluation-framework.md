# DarkAudit 평가 실행 가이드

> 현재 평가기 기준 · 2026-10-08

이 평가기는 탐지, 수정 전후 비교, 설명·개선안, RAG 챗봇을 각각 평가한다. 기본 탐지·비교 집계는 표준 라이브러리만 사용하며 API를 호출하지 않는다. 예제 파일과 예제 평점은 실행 확인용 수작업 fixture이며 실제 모델 성능이나 전문가 평가 결과가 아니다.

실제 모델 호출 결과는 [2026-10-06 성능 보고서](performance-measurement-2026-10-06.md)에 정리했다. 탐지 132회, 챗봇 12문항, 설명·개선안 58건의 결과와 분모·한계를 함께 확인할 수 있다.

## 1. 탐지 평가

저장된 Flow별 예측을 정답 라벨과 비교한다. 저장소 루트에서 실행한다.

```bash
python -m ai.evaluation detection \
  --dataset data/synthetic/labels \
  --predictions /path/to/predictions/run-1 \
  --output /tmp/darkaudit-detection.json
```

API 없이 실행 가능한 작은 예제:

```bash
python -m ai.evaluation detection \
  --dataset ai/evaluation/examples/labels \
  --predictions ai/evaluation/examples/predictions \
  --rule-id DA-04
```

실제 분석 결과 생성은 기존 실행기를 쓴다. 다음 명령은 설정된 모델 API를 호출한다. `--visual`은 이미지 중심 경로이며, 생략하면 규칙 후보와 LLM을 결합한 경로다. 입력 경로가 다른 결과는 구분해 보고한다.

```bash
python -m backend.eval_hybrid --runs 3 --visual --output-dir /tmp/darkaudit-new-run
python -m ai.evaluation detection \
  --predictions /tmp/darkaudit-new-run/run-1 \
  --output /tmp/darkaudit-new-run/evaluation-v2.json
```

입력 HTML·스크린샷과 실행별 예측 원본은 생성물이며 Git에 포함하지 않는다. 기존 측정의 로컬 원본 경로는 새 clone에 없을 수 있으므로 재집계 전 파일 존재 여부를 확인한다. 저장소에 남긴 요약 JSON과 새로 실행한 결과를 구분한다.

분석 실행기는 실패한 Flow도 실패 JSON으로 저장한다. 성공 결과에는 탐지 목록 외에 `analysis` 원문을 보존하므로 설명·개선안 평가 입력을 구성할 수 있다. 평가기는 선택한 데이터셋의 Flow 파일만 읽으므로 같은 디렉터리의 종합 보고서를 예측으로 잘못 읽지 않는다.

### 지표와 분모

| 보고서 필드 | 정의 |
| --- | --- |
| `micro`, `per_rule` | Flow 안에서 각 규칙이 탐지됐는지에 대한 P/R/F1. 같은 규칙의 여러 탐지는 한 번으로 센다. 누락·실패·모의 출력은 정답 양성에 대해 FN으로 센다. |
| `macro` | 선택한 모든 규칙의 P/R/F1을 같은 비중으로 평균. 해당 규칙의 분모가 없으면 P/R/F1은 0이다. |
| `classification.micro.accuracy` | 판정 가능한 `(Flow, 규칙)` 쌍의 `(TP+TN)/(TP+FP+FN+TN)`. 보류 쌍은 분모에 없으므로 coverage와 함께 읽는다. |
| `classification.micro.balanced_accuracy` | 판정 가능한 쌍의 `(Recall+Specificity)/2`. 양성 또는 음성 분모가 없으면 null. |
| `classification.micro.specificity`, `fpr` | 판정 가능한 음성의 `TN/(TN+FP)`, `FP/(TN+FP)`. 분모가 없으면 null. |
| `classification.micro.coverage` | 판정 가능한 쌍 / 전체 정답 쌍. 탐지는 양성 판정이며, 음성 판정에는 명시적 `not_detected` 검사 기록이 필요하다. |
| `classification.micro.end_to_end_accuracy` | 올바른 양성·음성 판정 수 / 전체 쌍. 보류·실패도 분모에 포함한다. |
| `classification.micro.end_to_end_recall` | TP / 모든 정답 양성. 보류·실패한 정답 양성도 분모에 포함한다. |
| `classification.exact_match_accuracy` | 모든 대상 규칙이 판정 가능하고 정답과 일치한 Flow / 전체 Flow. |
| `classification.completion_rate` | 모든 대상 규칙에 탐지 결과와 일치하는 검사 기록이 있는 Flow / 전체 Flow. |
| `classification.failed_cases`, `incomplete_cases` | 실패 원인과 검사 기록 누락·근거 부족·미지원·기록 불일치 규칙. |
| `clean_regression.fpr` | 정상 Flow 중 판정 가능한 `(Flow, 규칙)` 쌍의 FPR. 전체 데이터 FPR과 구분한다. |
| `instance_detection` | 규칙·화면이 같고 IoU가 임계값 이상인 개별 요소를 일대일 매칭한 P/R/F1. 예측 누락은 FN, 중복 탐지는 FP. |
| `localization` | 위치 IoU와 적중률. 예측이 없는 정답 요소도 분모에 포함한다. 적중률은 요소 평가와 같은 최대 일대일 매칭을 사용한다. 평균 IoU는 이 매칭을 우선하고 남은 영역의 겹침을 순차 매칭해 계산한다. |
| `counterfactual_consistency` | 원본·정상 쌍의 규칙별 존재 여부를 모두 맞힌 비율. 한쪽 예측이 누락·실패하면 해당 쌍은 오답. 음성/음성 규칙도 포함하므로 단독 대표 지표로 쓰지 않는다. |

`classification`의 P/R/F1은 **판정 가능한 쌍만** 대상으로 한다. 최상위 `micro`의 Recall은 누락·보류된 정답 양성까지 미탐으로 세므로 두 값은 다를 수 있다. 데이터셋은 지원 5종 DA-03/04/07/12/15를 기본 범위로 하며, `--rule-id`를 반복 지정해 좁힐 수 있다. IoU 기본 임계값은 0.5다.

예측 JSON에는 `flow_id`, `output.detections`, `telemetry.rule_assessments`를 넣는다. 검사 기록은 규칙마다 `{ "rule_id": "DA-04", "status": "detected" }` 또는 `not_detected`, `insufficient_evidence`, `not_supported`를 사용한다. 기록 없는 과거 예측은 미탐지 항목을 정상으로 추정하지 않는다. 따라서 과거 파일의 분류 coverage가 낮을 수 있다. v2에서는 누락 처리와 일부 분모가 바뀌었으므로 과거 보고서와 직접 비교하기 전에 동일한 파일을 다시 집계해야 한다.

## 2. 수정 전후 비교

```bash
python -m ai.evaluation regression --dataset ai/evaluation/examples/regression.jsonl
```

각 행은 `id`, `expected`, `predicted`를 갖는다. 두 객체는 독립 검수자가 부여한 안정적인 문제 ID에서 상태로 가는 매핑이다. 상태는 `resolved`, `persisted`, `improved`, `new`, `regressed`, `pending`이다. 운영 API의 회차별 finding ID를 그대로 같은 문제로 간주하지 말고 문제 대응표를 만들어야 한다. 정답을 현재 비교 엔진 출력에서 복사하지 않는다.

상태별 P/R/F1, 6개 상태의 Macro F1, 혼동행렬, 정확도, 누락·추가 예측 수를 출력한다. 정확도 분모는 정답·예측 문제 ID의 합집합이다. `false_resolved_rate`는 ‘해결’이라고 예측한 항목 중 실제로 해결 상태가 아닌 비율이다. 해결 예측 자체가 없으면 null이며, Recall과 함께 확인한다.

## 3. 설명·개선안

독립적으로 확인한 `evidence`, 적용할 `rule`, 평가할 `explanation`, `recommendation`이 필요하다. 화면을 보게 하려면 `image_paths`를 추가한다(실행 디렉터리 기준 파일 경로). 모델이 생성한 설명을 검증된 관찰 근거로 복사하면 안 된다.

사람이 작성했거나 이미 저장된 평점을 오프라인으로 집계:

```bash
python -m ai.evaluation quality \
  --dataset ai/evaluation/examples/quality.jsonl \
  --judgments ai/evaluation/examples/judgments.jsonl
```

평가 모델로 심사(환경에 `OPENAI_API_KEY`를 설정해야 하며 API 호출 발생):

```bash
python -m ai.evaluation quality \
  --dataset /path/to/reviewed-quality-cases.jsonl \
  --judge-model YOUR_JUDGE_MODEL \
  --output /tmp/darkaudit-quality.json
```

근거 충실성(`groundedness`), 규칙 적용 타당성(`rule_validity`), 실행 가능성(`actionability`)을 1~5점으로 평가한다. 각 점수의 근거, 분포, 평균, 심사 실패와 평가 완료율을 보존한다. API 오류·잘못된 점수·평점 누락은 성공 결과에서 제외하되 실패와 분모에 남긴다.

이 구현은 **G-Eval에서 착안한 과업별 rubric judge**이며 원 논문의 토큰 확률 가중 점수를 재현하는 구현은 아니다. 점수를 탐지 정확도와 합쳐 하나의 정확도로 표시하지 않는다. 평가 모델·rubric 버전을 고정하고, 일부 사례를 사람이 독립 평가해 평가 모델의 편향을 확인한다.

## 4. RAG 챗봇

선택 의존성을 별도로 설치한다. 기본 실행 환경에 필수로 설치할 필요는 없다.

```bash
python -m pip install -r requirements-eval.txt
python -m ai.evaluation rag \
  --dataset /path/to/chatbot-results.jsonl \
  --judge-model YOUR_JUDGE_MODEL \
  --embedding-model YOUR_EMBEDDING_MODEL \
  --output /tmp/darkaudit-rag.json
```

Ragas 0.4.3 collections API의 Faithfulness, AnswerRelevancy, ContextPrecision, ContextRecall을 사용한다. 호환성을 확인한 langchain-community 0.4.1도 함께 고정했다(0.4.2는 Ragas가 import하는 모듈을 제거했다). 검색 근거에 대한 충실성, 질문 관련성, 검색 순위의 적절성, 정답에 필요한 정보 회수를 각각 평가한다. 관련성은 사실 정확도가 아니다. 관련성 점수는 코사인 유사도 특성상 음수일 수 있다.

입력 형식은 `ai/evaluation/examples/rag.jsonl`을 참고한다. 각 행에는 `id`, `user_input`, `response`, `retrieved_contexts`, `reference`가 필요하다. `reference`는 독립적으로 작성한 정답이다. `retrieved_contexts`에는 **생성 모델에 실제 전달한 검색 청크 전문을 순서대로** 저장한다. UI에 노출된 인용 문서만 또는 잘린 excerpt만 넣으면 검색 품질 평가가 왜곡된다. 현재 챗봇 API 응답은 인용된 excerpt만 반환하므로 그 응답만으로 검색 품질을 재구성할 수 없다.

실제 챗봇 경로로 답변과 검색 청크를 함께 수집하려면 다음 명령을 먼저 실행한다. 질문 파일은 `id`, `user_input`, 독립 정답 `reference`를 갖는다(`examples/questions.jsonl` 참고). 단일 턴 평가이며 답변 생성·검색 임베딩 API를 호출한다.

```bash
python -m ai.evaluation collect-rag \
  --dataset /path/to/reviewed-questions.jsonl \
  --model YOUR_CHAT_MODEL --embedding-model YOUR_EMBEDDING_MODEL \
  --output /tmp/darkaudit-chatbot-results.json
python -m ai.evaluation rag \
  --dataset /tmp/darkaudit-chatbot-results.json \
  --judge-model YOUR_JUDGE_MODEL --embedding-model YOUR_EMBEDDING_MODEL
```

수집기는 운영 `DarkPatternChatbot.ask`의 검색·생성·후처리 경로를 사용하되 인용 필터 이전의 전체 청크를 저장한다. 수집 실패도 `error`가 있는 사례로 남기며 후속 평가에서 분모에 포함한다. `rag` 명령 자체는 저장된 답변만 평가한다. 오류 표시 없는 빈 응답 등 잘못된 입력은 입력 오류다. 평가 API 오류·NaN은 해당 점수를 null로 기록하고 지표별 coverage와 실패 수를 함께 출력한다. 오류 때문에 평가가 일부만 완료되면 종료 코드는 1이다.

## 5. 실행 결과와 품질 게이트

- 종료 코드 `0`: 지정한 검사 통과. `1`: 완료율·성능 기준 미달. `2`: 입력·설정 오류.
- 기본 게이트는 탐지의 검사 완료율 100% 및 실패 0, 비교의 예측 누락·추가 0 및 잘못된 해결 판정 0, 설명/RAG의 평가 완료율 100%다. 기본 게이트 통과가 높은 모델 성능을 뜻하지 않는다.
- 탐지는 `--min-macro-f1`, `--max-clean-fpr`, `--min-completion`, 비교는 `--min-macro-f1`, `--max-false-resolved-rate`, 설명/RAG는 `--min-score`로 기준을 지정한다. 설명은 1~5, RAG 임계값은 0~1이다. 기준이 지정됐는데 해당 지표가 null이면 통과시키지 않는다(해결 예측이 아예 없는 비교의 오해결 비율 게이트는 예외이며 0건으로 처리).
- `--output`은 기존 파일을 덮어쓰지 않는다. 보고서는 생성 시각, 입력 SHA-256, 평가 방식·버전과 해당 시 평가 모델을 담는다. API 키는 보고서에 넣지 않는다.
- 모델·프롬프트를 바꾸면 같은 사례를 반복 실행하고 회차별 점수와 변동을 함께 비교한다. 기존 합성 22 Flow/110화면은 작은 개발 평가셋이며 독립 실무 평가를 대체하지 않는다.

## 6. 구현 검증

```bash
python -m unittest ai.tests.test_evaluation ai.tests.test_clean_regression ai.tests.test_evaluation_framework -v
# requirements-eval.txt가 설치된 환경: 실제 Ragas 계산, API 경계만 모의 처리
python -m unittest ai.tests.test_ragas_integration -v
```

테스트는 정답 누락, 모의 출력, 보류, 위치 불일치·중복, 잘못된 해결 판정, 심사 실패, 비정상 점수, CLI 종료 코드와 파일 보존을 검증한다. 실제 유료 API 호출은 하지 않는다.

참고: [scikit-learn 분류 지표](https://scikit-learn.org/stable/modules/model_evaluation.html), [G-Eval 논문](https://arxiv.org/abs/2303.16634), [Ragas 지표 문서](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/).
