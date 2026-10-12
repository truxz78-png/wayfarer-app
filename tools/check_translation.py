"""Daily check of Wayfarer's automatic translation.

1. Asks Google's translate endpoint (the same one translate.js uses) to
   translate test phrases into six languages (Latin, Arabic, Devanagari
   and Chinese scripts).
2. Checks that translate.js is online on the website and still points to
   that endpoint.

If something fails, it opens a GitHub Issue (GitHub also sends it by email).
When everything works again, it closes that issue on its own.
While it is broken, visitors simply see the app in English.
"""
import os
import requests

SITE = "https://truxz78-png.github.io/wayfarer-app/translate.js"
ENDPOINT = "https://translate.googleapis.com/translate_a/single"
# Six languages that cover the main writing systems: Latin (es, pt, fr),
# Arabic (right to left), Devanagari (hi) and Chinese characters (zh).
TESTS = [("es", "Hello", "hola"), ("pt", "Thank you", "obrigad"),
         ("fr", "Good morning", "bonjour"), ("ar", "Hello", "مرحب"),
         ("hi", "Hello", "नमस्"), ("zh-CN", "Hello", "你好")]
TITLE = "Translation problem"


def translate(lang, text):
    r = requests.get(ENDPOINT, timeout=20, params={
        "client": "gtx", "sl": "en", "tl": lang, "dt": "t", "q": text})
    r.raise_for_status()
    data = r.json()
    return "".join(part[0] or "" for part in data[0])


def run_checks():
    problems = []
    for lang, text, expect in TESTS:
        try:
            out = translate(lang, text)
            if expect not in out.lower():
                problems.append(f"{lang}: '{text}' came back as '{out}'")
        except Exception as e:  # network, blocked, format changed
            problems.append(f"{lang}: request failed ({type(e).__name__}: {e})")
    try:
        r = requests.get(SITE, timeout=20)
        if r.status_code != 200:
            problems.append(f"translate.js on the website: HTTP {r.status_code}")
        elif "translate.googleapis.com" not in r.text:
            problems.append("translate.js on the website no longer uses the endpoint")
    except Exception as e:
        problems.append(f"translate.js on the website: not reachable ({e})")
    return problems


def github():
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        return None, None
    return (f"https://api.github.com/repos/{repo}/issues",
            {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})


def main():
    problems = run_checks()
    api, h = github()
    open_issue = None
    if api:
        found = requests.get(api, headers=h, timeout=20,
                             params={"state": "open", "labels": "translation-check"}).json()
        open_issue = next((i for i in found if isinstance(i, dict) and i.get("title") == TITLE), None)

    if problems:
        body = ("The automatic translation is not working. Visitors see the app in English "
                "until it is fixed.\n\n" + "\n".join(f"- {p}" for p in problems))
        print(body)
        if api:
            if open_issue:
                requests.post(open_issue["comments_url"], headers=h, timeout=20,
                              json={"body": "Still failing:\n\n" + body})
            else:
                requests.post(api, headers=h, timeout=20,
                              json={"title": TITLE, "body": body, "labels": ["translation-check"]})
    else:
        print("Translation OK")
        if api and open_issue:
            requests.post(open_issue["comments_url"], headers=h, timeout=20,
                          json={"body": "Translation is working again. Closing automatically."})
            requests.patch(open_issue["url"], headers=h, timeout=20, json={"state": "closed"})


if __name__ == "__main__":
    main()
