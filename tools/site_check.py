"""Daily check of Wayfarer's pages: home, Privacy Policy and Terms of Service.

For each page it checks that:
  - the page opens (HTTP 200),
  - it loads the automatic translator (translate.js),
  - it still has its important links (back link, Privacy, Terms, Contact).
It also checks that translate.js is online and that Google's translator
answers a legal phrase in Spanish without turning "Privacy Policy" into
"póliza" (an insurance word).

If something fails, it opens a GitHub Issue "Site problem" (GitHub also
sends it by email). When everything works again, it closes that issue.
"""
import os
import requests

BASE = os.environ.get("SITE_BASE", "https://truxz78-png.github.io/wayfarer-app/")
PAGES = {
    "": ["translate.js", "privacy.html", "terms.html", "mailto:hpind77@gmail.com"],
    "privacy.html": ["translate.js", "back-link", "terms.html", "mailto:hpind77@gmail.com"],
    "terms.html": ["translate.js", "back-link", "privacy.html", "mailto:hpind77@gmail.com"],
}
ENDPOINT = "https://translate.googleapis.com/translate_a/single"
PHRASE = "Changes to This Privacy Policy"
TITLE = "Site problem"
LABEL = "site-check"


def run_checks():
    problems = []
    for page, needs in PAGES.items():
        name = page or "home page"
        try:
            r = requests.get(BASE + page, timeout=25)
        except Exception as e:
            problems.append(f"{name}: not reachable ({type(e).__name__})")
            continue
        if r.status_code != 200:
            problems.append(f"{name}: HTTP {r.status_code}")
            continue
        for item in needs:
            if item not in r.text:
                problems.append(f"{name}: missing '{item}'")
    try:
        r = requests.get(BASE + "translate.js", timeout=25)
        if r.status_code != 200 or "translate.googleapis.com" not in r.text:
            problems.append(f"translate.js: HTTP {r.status_code} or no translator endpoint")
    except Exception as e:
        problems.append(f"translate.js: not reachable ({type(e).__name__})")
    try:
        r = requests.get(ENDPOINT, timeout=20, params={
            "client": "gtx", "sl": "en", "tl": "es", "dt": "t", "q": PHRASE})
        r.raise_for_status()
        out = "".join(part[0] or "" for part in r.json()[0]).lower()
        if "póliza" in out or "poliza" in out:
            problems.append(f"translator turned '{PHRASE}' into '{out}' (póliza)")
        elif "privacidad" not in out:
            problems.append(f"translator answered '{out}' for '{PHRASE}'")
    except Exception as e:
        problems.append(f"translator: request failed ({type(e).__name__})")
    return problems


def main():
    problems = run_checks()
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    api = f"https://api.github.com/repos/{repo}/issues" if token and repo else None
    h = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    issue = None
    if api:
        found = requests.get(api, headers=h, timeout=20,
                             params={"state": "open", "labels": LABEL}).json()
        issue = next((i for i in found if isinstance(i, dict) and i.get("title") == TITLE), None)
    if problems:
        body = "Problems found on the website:\n\n" + "\n".join(f"- {p}" for p in problems)
        print(body)
        if api:
            if issue:
                requests.post(issue["comments_url"], headers=h, timeout=20,
                              json={"body": "Still failing:\n\n" + body})
            else:
                requests.post(api, headers=h, timeout=20,
                              json={"title": TITLE, "body": body, "labels": [LABEL]})
        raise SystemExit(1)
    print("All pages OK: home, privacy.html, terms.html, translate.js, translator.")
    if api and issue:
        requests.post(issue["comments_url"], headers=h, timeout=20,
                      json={"body": "Everything works again. Closing."})
        requests.patch(issue["url"], headers=h, timeout=20, json={"state": "closed"})


if __name__ == "__main__":
    main()
