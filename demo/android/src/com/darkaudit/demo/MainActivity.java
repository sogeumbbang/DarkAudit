package com.darkaudit.demo;

import android.app.Activity;
import android.os.Bundle;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Offline synthetic micro-investing flow. No account, network, payment or personal data. */
public class MainActivity extends Activity {
    private final int ink = Color.rgb(21, 49, 45);
    private final int accent = Color.rgb(0, 119, 103);
    private final int muted = Color.rgb(112, 133, 128);
    private final int soft = Color.rgb(234, 246, 239);
    private LinearLayout content;
    private int step = 1;
    private boolean clean;
    private final boolean[] selected = new boolean[3];
    private static final String[] NAMES = {"플랜 소개", "투자 설정", "혜택 알림", "혜택 포기 확인", "투자 위험 확인", "최종 이용료"};

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        clean = getIntent().getBooleanExtra("clean", false);
        step = state == null ? 1 : state.getInt("step", 1);
        boolean[] saved = state == null ? null : state.getBooleanArray("selected");
        for (int i = 0; i < selected.length; i++) selected[i] = saved == null ? !clean : saved[i];
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        render();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private GradientDrawable background(int color, int radius) {
        GradientDrawable bg = new GradientDrawable(); bg.setColor(color); bg.setCornerRadius(dp(radius)); return bg;
    }
    private LinearLayout stack() {
        LinearLayout view = new LinearLayout(this); view.setOrientation(LinearLayout.VERTICAL); return view;
    }
    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setIncludeFontPadding(false); view.setLineSpacing(dp(3), 1);
        view.setPadding(0, dp(5), 0, dp(5));
        if (bold) view.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        content.addView(view); return view;
    }
    private void gap(int height) { View view = new View(this); content.addView(view, new LinearLayout.LayoutParams(1, dp(height))); }
    private void paragraph(String value) { text(value, 12, muted, false); }
    private void heading(String tag, String title, String description) {
        TextView badge = text(tag, 11, accent, true); badge.setBackground(background(soft, 5));
        badge.setPadding(dp(9), dp(6), dp(9), dp(6));
        badge.setLayoutParams(new LinearLayout.LayoutParams(-2, -2));
        gap(12); text(title, 29, ink, true); gap(5); paragraph(description); gap(15);
    }
    private LinearLayout card(int color) {
        LinearLayout view = stack(); view.setPadding(dp(19), dp(17), dp(19), dp(17));
        view.setBackground(background(color, 17));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2); lp.bottomMargin = dp(13);
        content.addView(view, lp); return view;
    }
    private void feature(String value) { text("✓   " + value, 12, ink, false); }
    private void button(LinearLayout parent, String label, boolean secondary) {
        Button button = new Button(this); button.setText(label); button.setAllCaps(false);
        button.setTextSize(secondary && !clean ? 10 : 14);
        button.setTextColor(secondary && !clean ? Color.rgb(178, 187, 182) : Color.WHITE);
        button.setBackground(background(secondary && !clean ? Color.WHITE : accent, 12));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(secondary && !clean ? 31 : 52));
        lp.topMargin = dp(secondary ? 5 : 8); parent.addView(button, lp);
        button.setOnClickListener(v -> { step = Math.min(6, step + 1); render(); });
    }
    private void check(String label, String detail, int index) {
        LinearLayout outer = content; LinearLayout box = card(soft); content = box;
        CheckBox check = new CheckBox(this); check.setText(label); check.setTextSize(13); check.setTextColor(ink);
        check.setButtonTintList(ColorStateList.valueOf(accent)); check.setChecked(selected[index]);
        check.setOnCheckedChangeListener((v, checked) -> selected[index] = checked);
        box.addView(check); text(detail, 10, muted, false); content = outer;
    }
    private void graphic(String label, String amount, String detail) {
        LinearLayout outer = content; content = card(accent);
        text(label, 11, Color.rgb(191, 225, 213), false);
        text(amount, 38, Color.WHITE, true); text(detail, 12, Color.WHITE, false);
        gap(10); text("▁  ▂  ▂  ▃  ▂  ▄  ▅  ▄  ▆  ▇", 22, Color.rgb(178, 227, 157), true);
        content = outer;
    }
    private void render() {
        LinearLayout root = stack(); root.setBackgroundColor(Color.WHITE); root.setPadding(dp(24), dp(13), dp(24), dp(8));
        setContentView(root); content = root;
        text("moa   모아 소액투자", 23, accent, true);
        gap(9); text("MICRO INVESTING                         " + step + " / 6", 10, muted, true);
        LinearLayout progress = new LinearLayout(this); progress.setOrientation(LinearLayout.HORIZONTAL);
        for (int i=0; i<6; i++) { View bar=new View(this); bar.setBackground(background(i<step ? accent : soft, 2)); LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,dp(3),1); lp.rightMargin=dp(4); progress.addView(bar,lp); }
        root.addView(progress); gap(18);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setVerticalScrollBarEnabled(false);
        root.addView(scroll, new LinearLayout.LayoutParams(-1,0,1)); content=stack(); scroll.addView(content);
        String primary = "다음", secondary = null;
        switch(step) {
            case 1:
                heading("작게 시작하는 나의 투자", "오늘의 작은 돈이\n내일의 가능성으로", "모아 라이트 멤버십\n투자 정보와 포트폴리오 관리를 한곳에서.");
                graphic("모아 성장 포트폴리오", "+12.8%", "최근 1년 수익률 예시");
                text("월 이용료 총액     " + (clean ? "8,400원" : "6,900원"), 21, ink, true);
                if(clean) paragraph("기본료 6,900원 + 필수 관리비 1,500원");
                feature("1,000원부터 살펴보는 분산투자"); feature("매일 확인하는 자산 리포트");
                text("과거 수익률은 미래 수익을 보장하지 않습니다. 원금 손실이 최대 100% 발생할 수 있으며 예금자보호 대상이 아닙니다.", clean ? 14 : 9, clean ? ink : Color.rgb(193,203,197), false);
                primary="다음 · 투자 설정 보기"; break;
            case 2:
                heading("나를 위한 추천 설정", "투자 습관,\n미리 준비해 뒀어요", "편리한 관리를 위한 선택사항이에요.\n원하지 않는 항목은 해제할 수 있어요.");
                check("[선택] 만기 자동 재투자", "수익과 원금을 같은 상품에 다시 투자 / 무료", 0);
                check("[선택] 제휴사 정보 제공", "맞춤 금융상품 광고를 위한 제3자 제공 / 무료", 1);
                check("[선택] 광고성 정보 수신", "앱 푸시와 이메일로 혜택 소식 받기 / 무료", 2);
                paragraph("선택사항에 동의하지 않아도\n기본 멤버십을 이용할 수 있습니다.");
                primary="다음 · 이 설정으로 계속"; break;
            case 3:
                heading("기회가 찾아오는 순간", "나에게 맞는 소식,\n먼저 받아보세요", "광고성 상품 추천 알림입니다.\n수신 여부와 멤버십 이용료는 무관해요.");
                graphic("MOA INSIGHT", "나만의 투자 소식", "새로운 상품 · 파트너 혜택");
                feature("관심 자산의 상품 광고"); feature("제휴 서비스 프로모션");
                primary="다음 · 혜택 알림 받기"; secondary="알림 없이 계속"; break;
            case 4:
                heading("잠깐, 놓치기 전에", "이 기회를\n그냥 보내실 건가요?", "투자 혜택 알림을 한 번 더 안내드려요.");
                graphic("YOUR NEXT OPPORTUNITY", "나만 놓친다면?", "준비된 혜택 소식이 기다리고 있어요");
                text(clean ? "알림 없이도 기본 서비스를 동일하게 이용할 수 있습니다." : "남들은 챙기는 혜택을 혼자 포기하고\n나중에 후회하시겠어요?", 20, clean ? ink : Color.rgb(169,72,47), true);
                primary="다음 · 혜택 유지"; secondary=clean ? "알림 없이 계속" : "저는 좋은 기회를 놓칠게요"; break;
            case 5:
                heading("투자 전 마지막 확인", "내 선택을\n한 번 더 확인해요", "모아 라이트 멤버십\n상품 정보 확인을 위한 사전 안내입니다.");
                LinearLayout outer=content; content=card(soft);
                text("투자 위험 확인", 19, ink, true);
                text(clean ? "원금 손실 위험이 있음을 이해하셨나요?" : "원금 손실 위험을 이해하지 못한 것은\n아니시죠?", 17, ink, true);
                paragraph("‘예’와 ‘아니요’ 중 하나를 선택해 주세요."); content=outer;
                text("원금 보장은 없으며 손실은 투자자에게 귀속됩니다. 투자 성향에 맞는 상품인지 확인해야 합니다.", clean ? 14 : 9, clean ? ink : Color.rgb(193,203,197), false);
                primary="다음 · 예"; secondary="아니요 · 계속 보기"; break;
            case 6:
                heading("멤버십 이용료 확인", "작은 시작의\n최종 이용료", "모아 라이트 · 동일한 기본 멤버십\n추가 유료 옵션은 없습니다.");
                LinearLayout parent=content; content=card(soft);
                text("MOA / MEMBERSHIP SUMMARY", 10, accent, true); gap(16);
                text("기본 멤버십                     6,900원", 14, ink, false);
                text("필수 자산 관리비             1,500원", 14, ink, false); gap(16);
                text("월 이용료 총액", 12, muted, false); text("8,400원", 36, accent, true); content=parent;
                paragraph("자산 관리비는 필수이며 모든 멤버십에 적용됩니다.\n자동 재투자·알림 설정과 무관한 비용입니다.");
                gap(16); text("✓  데모 흐름을 모두 확인했어요", 15, accent, true);
                paragraph("실제 투자·계약·결제는 발생하지 않습니다."); break;
        }
        LinearLayout actions=stack(); root.addView(actions);
        if(step<6) { button(actions,primary,false); if(secondary!=null) button(actions,secondary,true); }
        content=root; gap(8); TextView footer=text("DarkAudit 가상 데모 · 실제 금융상품이 아닙니다",8,muted,false); footer.setGravity(Gravity.CENTER);
        setTitle("모아 소액투자 · " + NAMES[step-1]);
    }
    @Override public void onBackPressed() { if(step>1) { step--; render(); } else super.onBackPressed(); }
    @Override protected void onSaveInstanceState(Bundle out) { out.putInt("step",step); out.putBooleanArray("selected",selected); super.onSaveInstanceState(out); }
}
