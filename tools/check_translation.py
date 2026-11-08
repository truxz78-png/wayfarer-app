"""Daily check of Wayfarer's automatic translation.

1. Checks that index.html, privacy.html and terms.html load translate.js and
   have <meta name="google" content="notranslate">, and that translate.js
   still uses Google's endpoint ("translate_a/single").
2. Asks Google's translator ONE question: up to 3 languages (es, ar, zh-CN),
   5 seconds apart, and STOPS as soon as one answers correctly.
   The Spanish test uses the legal phrase "Changes to This Privacy Policy"
   and fails if it comes back as "póliza".

Results:
  - HTTP 429 (Google busy, common from GitHub's shared servers): only a
    WARNING in the log. The run stays green, no issue, no email. It tries
    again tomorrow.
  - A real error (empty answer, other HTTP code, not JSON, wrong text,
    missing page parts): opens the GitHub Issue "Translation problem".
  - When everything works again, it closes that issue on its own.

This robot only checks and reports. It never changes the website.
"""
import os
import time
import requests

BASE = os.environ.get("SITE_BASE", "https://truxz78-png.github.io/wayfarer-app/")
PAGES = ["", "privacy.html", "terms.html"]
ENDPOINT = "https://translate.googleapis.com/translate_a/single"
UA = {"User-Agent": "Mozilla/5.0"}
TESTS = [("es", "Changes to This Privacy Policy", "privacidad"),
         ("ar", "Hello", "مرحب"),
         ("zh-CN", "Hello", "你好")]
PAUSE = 5
TITLE = "Translation problem"
LABEL = "translation-check"


def check_pages():
    problems = []
    for page in PAGES:
        name = page or "index.html"
        try:
            r = requests.get(BASE + page, headers=UA, timeout=25)
        except Exception as e:
            problems.append(f"{name}: not reachable ({type(e).__name__})")
            continue
        if r.status_code != 200:
            problems.append(f"{name}: HTTP {r.status_code}")
            continue
        if "translate.js" not in r.text:
            problems.append(f"{name}: does not load translate.js")
        if 'name="google" content="notranslate"' not in r.text:
            problems.append(f'{name}: missing <meta name="google" content="notranslate">')
    try:
        r = requests.get(BASE + "translate.js", headers=UA, timeout=25)
        if r.status_code != 200:
            problems.append(f"translate.js: HTTP {r.status_code}")
        elif "translate_a/single" not in r.text:
            problems.append("translate.js no longer uses translate_a/single")
    except Exception as e:
        problems.append(f"translate.js: not reachable ({type(e).__name__})")
    return problems


def check_translator():
    """Returns (problems, busy). busy=True means only 429 answers."""
    errors, busy = [], False
    for i, (lang, text, expect) in enumerate(TESTS):
        if i:
            time.sleep(PAUSE)
        try:
            r = requests.get(ENDPOINT, headers=UA, timeout=20, params={
                "client": "gtx", "sl": "en", "tl": lang, "dt": "t", "q": text})
        except Exception as e:
            errors.append(f"{lang}: request failed ({type(e).__name__})")
            continue
        if r.status_code == 429:
            busy = True
            print(f"AVISO: Google estaba ocupado (HTTP 429) en {lang}")
            continue
        if r.status_code != 200:
            errors.append(f"{lang}: HTTP {r.status_code}")
            continue
        try:
            out = "".join(part[0] or "" for part in r.json()[0])
        except Exception:
            errors.append(f"{lang}: answer is not valid JSON")
            continue
        low = out.lower()
        if not out.strip():
            errors.append(f"{lang}: empty answer")
        elif "póliza" in low or "poliza" in low:
            errors.append(f"{lang}: '{text}' came back as '{out}' (póliza)")
        elif expect not in low:
            errors.append(f"{lang}: '{text}' came back as '{out}'")
        else:
            print(f"OK: el traductor responde ({lang}): {out}")
            return errors, False
    if busy and not errors:
        return [], True
    return errors, False


def main():
    problems = check_pages()
    tr_problems, busy = check_translator()
    problems += tr_problems
    if busy:
        print("AVISO: Google estaba ocupado (429). Se vuelve a probar mañana.")

    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    api = f"https://api.github.com/repos/{repo}/issues" if token and repo else None
    h = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    issue = None
    if api:
        found = requests.get(api, headers=h, timeout=20,
                             params={"state": "open", "labels": LABEL}).json()
        issue = next((i for i in found if isinstance(i, dict) and i.get("title") == TITLE), None)

    if problems:
        body = ("The automatic translation check found a real problem. Visitors may "
                "see the app in English until it is fixed.\n\n"
                + "\n".join(f"- {p}" for p in problems))
        print(body)
        if api:
            if issue:
                requests.post(issue["comments_url"], headers=h, timeout=20,
                              json={"body": "Still failing:\n\n" + body})
            else:
                requests.post(api, headers=h, timeout=20,
                              json={"title": TITLE, "body": body, "labels": [LABEL]})
        raise SystemExit(1)

    print("Pages OK: index.html, privacy.html, terms.html, translate.js.")
    if api and issue and not busy:
        requests.post(issue["comments_url"], headers=h, timeout=20,
                      json={"body": "Everything works again. Closing."})
        requests.patch(issue["url"], headers=h, timeout=20, json={"state": "closed"})


if __name__ == "__main__":
    main()
