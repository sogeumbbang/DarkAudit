import json,os
from playwright.sync_api import sync_playwright
S=[
 ("s1",(450,60,1260,720),"새 진단 만들기",
  [(461,209,1245,426),(461,451,721,708),(759,527,1225,595)],
  ["처음이라면 <b>입력 유형별 데모 체험</b>으로 원본 검사 → 수정본 검사 → 전후 비교를 먼저 둘러보세요",
   "<b>진단 이름</b>과 <b>상품 유형</b>을 입력합니다 (예: 반려동물 보험 가입 화면 1차)",
   "입력 방식을 고릅니다 · <b>웹사이트 · Figma · Android 앱 · 스크린샷</b>"]),
 ("s2",(450,20,1260,725),"화면 등록하고 분석 시작",
  [(1109,339,1221,399),(759,530,1225,657),(1129,690,1245,717)],
  ["스크린샷으로 점검할 때는 <b>스크린샷</b>을 선택합니다",
   "가입 순서대로 <b>1~6장</b> 등록 · PNG·JPG·WEBP, 장당 10MB 이하 · 등록 후에는 순서를 바꿀 수 없어요",
   "<b>분석 시작하기</b>를 누르면 진행 화면에서 수집·분석 상태를 볼 수 있습니다"]),
 ("s3",(450,40,1260,520),"결과 요약 보기",
  [(461,158,1245,200),(461,212,1245,306),(461,320,1245,380),(461,443,1245,514)],
  ["<b>원본 검사 → 수정본 검사 → 전후 비교</b> 순서로 진행 단계가 표시됩니다",
   "검토 후보 · 검토 필요 · 해결 표시 · 등록 화면 수를 한눈에 확인",
   "<b>검사 범위와 추가 확인 사항</b>을 먼저 읽으세요 · 미지원 규칙과 근거 부족 항목이 여기 나옵니다",
   "화면 흐름에서 화면을 고르면 그 화면의 후보만 볼 수 있습니다"]),
 ("s4",(450,90,1260,735),"화면 근거 확인하고 검토 기록 남기기",
  [(558,548,774,588),(889,312,1229,454),(889,605,1229,671),(1172,254,1212,278)],
  ["항목을 고르면 <b>화면 위 위치</b>가 강조됩니다",
   "<b>WHERE · OBSERVATION · RULE · WHY</b> · 어디서 무엇을 보고 어떤 기준으로 판단했는지",
   "<b>FIX</b> · 문구·선택 상태·정보 공개 방식을 어떻게 바꿀지 개선 권고안",
   "처리 상태 <b>미검토 → 검토 중 → 해결됨</b>과 수정 결정 메모를 남깁니다"]),
 ("s5",(450,40,1260,590),"수정본 재검사",
  [(724,158,982,200),(461,225,848,514),(859,225,1245,514),(1139,536,1237,570)],
  ["결과 화면에서 <b>수정본 검사</b> 탭을 엽니다",
   "원본에서 찾은 항목이 유형별로 정리되어 있습니다",
   "같은 순서·단계명으로 <b>수정본 화면</b>을 등록합니다",
   "<b>수정본 검사 시작</b> → 같은 진단에 새 회차로 저장되고, <b>전후 비교</b>에서 결과를 봅니다"]),
 ("s6",(437,31,1123,746),"PDF 보고서로 공유",
  [(977,42,1066,77),(477,397,1082,465),(477,508,1082,645)],
  ["<b>PDF 보고서 출력 → 인쇄 / PDF 저장</b> · 인쇄 대상에서 ‘PDF로 저장’을 고릅니다",
   "진단 요약 · 대상 화면 · 탐지 · 검토 필요 · 해결 건수",
   "분석 범위와 한계, 화면별 근거, 저장된 수정 결정까지 함께 담깁니다"]),
]
CSS=open('assets.html').read().split('<style>')[1].split('</style>')[0]
extra="""
.st .card{padding:28px 30px 26px}
.shot{position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:#f5f3ed}
.shot img{display:block;width:100%}
.hl{position:absolute;border:2.5px solid #2563EB;border-radius:8px;background:rgba(37,99,235,.06)}
.hl b{position:absolute;left:-12px;top:-12px;width:26px;height:26px;border-radius:50%;background:#2563EB;color:#fff;font-family:J;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px #fff}
.notes{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;margin-top:18px}
.note{display:flex;gap:10px;font-family:W;font-weight:500;font-size:14.5px;line-height:1.5;color:#2b3550}
.note i{flex:none;font-style:normal;width:22px;height:22px;border-radius:50%;background:#2563EB;color:#fff;font-family:J;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;margin-top:1px}
.note b{color:var(--navy);font-weight:700}
.sh{display:flex;align-items:baseline;gap:12px;margin-bottom:16px}
.sh .no{font-family:J;font-weight:800;font-size:13px;color:#fff;background:var(--navy);border-radius:8px;padding:4px 10px;letter-spacing:.04em}
.sh .tt{font-family:W;font-weight:700;font-size:23px;letter-spacing:-0.02em}
"""
html=f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}{extra}</style></head><body>'
for k,(name,(x0,y0,x1,y1),title,hls,notes) in enumerate(S,1):
    W=x1-x0; H=y1-y0; disp=820; sc=disp/W
    boxes="".join(f'<div class="hl" style="left:{(a-x0)*sc:.1f}px;top:{(b-y0)*sc:.1f}px;width:{(c-a)*sc:.1f}px;height:{(d-b)*sc:.1f}px"><b>{i}</b></div>' for i,(a,b,c,d) in enumerate(hls,1))
    img=f'<div class="shot" style="width:{disp}px;height:{H*sc:.1f}px"><img src="shots/{name}.jpg" style="position:absolute;left:{-x0*sc:.1f}px;top:{-y0*sc:.1f}px;width:{1568*sc:.1f}px;max-width:none">{boxes}</div>'
    nt="".join(f'<div class="note"><i>{i}</i><span>{t}</span></div>' for i,t in enumerate(notes,1))
    html+=f'<section class="a st" id="step{k}"><div class="card"><div class="sh"><span class="no">STEP {k}</span><span class="tt">{title}</span></div>{img}<div class="notes">{nt}</div></div></section>'
html+='</body></html>'
open('steps.html','w').write(html)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":960,"height":900},device_scale_factor=2)
    pg.goto("file://"+os.path.abspath("steps.html")); pg.wait_for_timeout(800)
    for k in range(1,len(S)+1):
        pg.locator(f"#step{k} .card").screenshot(path=f"../../images/readme/step{k}.png",omit_background=True)
    b.close()
