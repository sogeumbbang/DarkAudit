package com.darkaudit.demo;

import android.app.Activity;
import android.os.Bundle;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Offline, fictional financial flow for DarkAudit capture and rule evaluation. */
public class MainActivity extends Activity {
    private final int ink = Color.rgb(24, 60, 48);
    private final int green = Color.rgb(19, 121, 83);
    private LinearLayout content;
    private int step = 1;
    private boolean clean;
    private final boolean[] selected = new boolean[3];

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

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setPadding(0, dp(7), 0, dp(7));
        if (bold) view.setTypeface(null, Typeface.BOLD);
        content.addView(view);
        return view;
    }

    private void paragraph(String value) { text(value, 15, ink, false); }
    private void title(String value) { text(value, 27, ink, true); }
    private void price(String value) { text(value, 34, green, true); }

    private void button(String label, boolean secondary) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(secondary && !clean ? 11 : 17);
        button.setTextColor(secondary && !clean ? Color.rgb(172, 178, 174) : Color.WHITE);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(secondary && !clean ? Color.WHITE : green);
        bg.setCornerRadius(dp(10));
        button.setBackground(bg);
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, dp(secondary && !clean ? 40 : 58));
        layout.topMargin = dp(secondary ? 8 : 20);
        content.addView(button, layout);
        button.setOnClickListener(v -> { step = Math.min(5, step + 1); render(); });
    }

    private void render() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.WHITE);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(16), dp(24), dp(24));
        scroll.addView(content);
        setContentView(scroll);
        text("moa  모아 투자관리", 23, green, true);
        text("가상 서비스 · 테스트 전용", 11, Color.rgb(100,118,109), false);
        text(step + " / 5 · 모아 투자관리", 12, Color.rgb(100,118,109), false);
        switch (step) {
            case 1:
                title("투자의 시작을\n더 가볍게");
                paragraph("모아 투자관리 기본 플랜\n추가 옵션 없이 시작하는 투자 정보 서비스");
                paragraph("월 이용료 총액");
                price(clean ? "11,400원" : "9,900원");
                if (clean) paragraph("기본 이용료 9,900원 + 필수 관리수수료 1,500원");
                text("다양한 자산에 분산 투자", 21, green, true);
                text("안내된 투자상품은 원금 손실이 최대 100%까지 발생할 수 있으며 예금자보호 대상이 아닙니다.", clean ? 16 : 10, clean ? ink : Color.rgb(185,192,188), false);
                button("다음", false);
                break;
            case 2:
                title("나에게 맞는\n서비스 설정");
                paragraph("선택사항을 확인해 주세요.");
                String[] labels = {"[선택] 광고성 마케팅 정보 수신", "[선택] 제휴사 개인정보 제공", "[선택] 만기 시 자동 재투자"};
                for (int i = 0; i < labels.length; i++) {
                    final int index = i;
                    CheckBox box = new CheckBox(this);
                    box.setText(labels[i]);
                    box.setTextSize(16);
                    box.setTextColor(ink);
                    box.setButtonTintList(ColorStateList.valueOf(green));
                    box.setChecked(selected[i]);
                    box.setPadding(0, dp(14), 0, dp(14));
                    box.setOnCheckedChangeListener((v, checked) -> selected[index] = checked);
                    content.addView(box);
                }
                paragraph("모두 무료 선택사항입니다.\n동의하지 않아도 기본 서비스를 이용할 수 있습니다.");
                button("다음", false);
                break;
            case 3:
                title("혜택 알림을\n받으시겠어요?");
                paragraph("선택 서비스 · 무료");
                text("나에게 맞는 금융 혜택 소식", 21, green, true);
                paragraph("광고성 상품 추천 알림을 보내드립니다.\n이용료와 기본 서비스는 선택에 관계없이 동일합니다.");
                button("혜택 알림 받기", false);
                button("알림 없이 계속하기", true);
                break;
            case 4:
                title("혜택 소식을\n놓치지 마세요");
                paragraph("알림 서비스 최종 안내");
                text(clean ? "알림을 받지 않아도 기본 서비스를 동일하게 이용할 수 있습니다." : "지금 동의하지 않으면 준비된 혜택이 모두 사라집니다. 놓치고 후회하시겠어요?", clean ? 16 : 22, clean ? ink : Color.rgb(163,57,43), !clean);
                paragraph("혜택 알림은 무료 선택 서비스입니다.");
                button("다음", false);
                break;
            case 5:
                title("마지막으로\n이용료를 확인하세요");
                paragraph("모아 투자관리 · 동일한 기본 플랜\n추가 옵션 없음");
                paragraph("기본 이용료                         9,900원");
                paragraph("필수 관리수수료                  1,500원");
                paragraph("월 이용료 총액");
                price("11,400원");
                paragraph("테스트가 완료되었습니다.\n실제 계약이나 결제는 진행되지 않습니다.");
                break;
        }
        text("실제 금융상품이 아닙니다. 개인정보 입력과 실제 거래가 없습니다.", 11, Color.rgb(100,118,109), false);
    }

    @Override public void onBackPressed() {
        if (step > 1) { step--; render(); } else super.onBackPressed();
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        out.putInt("step", step);
        out.putBooleanArray("selected", selected);
        super.onSaveInstanceState(out);
    }
}
