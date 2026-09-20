package com.wayfarertravel.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private static final String SITE_URL = "https://truxz78-png.github.io/wayfarer-app/";
    private static final String SITE_HOST = "truxz78-png.github.io";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }
        });
        webView.loadUrl(SITE_URL);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    private boolean handleUrl(Uri uri) {
        String scheme = uri.getScheme();

        if ("https".equals(scheme) || "http".equals(scheme)) {
            if (SITE_HOST.equals(uri.getHost())) {
                return false; // nuestro sitio: se queda dentro de la app
            }
            openExternal(new Intent(Intent.ACTION_VIEW, uri));
            return true;
        }

        if ("intent".equals(scheme)) {
            try {
                Intent intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
                if (!openExternal(intent)) {
                    intent.setPackage(null); // sin la app, que lo abra el navegador
                    if (!openExternal(intent)) {
                        String fallback = intent.getStringExtra("browser_fallback_url");
                        if (fallback != null) {
                            openExternal(new Intent(Intent.ACTION_VIEW, Uri.parse(fallback)));
                        }
                    }
                }
            } catch (Exception ignored) {
            }
            return true;
        }

        openExternal(new Intent(Intent.ACTION_VIEW, uri)); // tel:, mailto:, etc.
        return true;
    }

    private boolean openExternal(Intent intent) {
        try {
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }
}
