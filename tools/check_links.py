"""Weekly partner link check for Wayfarer.

For each enabled partner in links.json it checks the primary, backup and
official links, keeps a count of consecutive real failures, and chooses the
best working link as "active". The page always uses the active link, so a
visitor never lands on a dead page.

Results per link:
  ok       - the link ends on the partner's own site (expected domain).
  unclear  - the site blocked the robot, or the link stayed on the affiliate
             network's redirect page. Counters are NOT changed (no switch).
  fail     - real failure: no connection, 404/410/5xx, or it ends on a site
             that is not the partner's.

A link is "down" after `fails_to_switch` failures in a row (default 2).
Order of preference: primary, backup, official. When the primary works again
the robot goes back to it on its own.

If settings.auto_switch is false, the robot only reports (no switching).
Problems are written as GitHub Issues, which GitHub also sends by email.
"""
import json
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests

LINKS_FILE = sys.argv[1] if len(sys.argv) > 1 else "links.json"
ORDER = ["primary", "backup", "official"]
UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")
BLOCK_CODES = {401, 403, 405, 406, 409, 429, 503, 999}
# Hosts of affiliate networks and redirectors. Ending here means the
# redirect did not finish (often a JavaScript redirect), not a failure.
NETWORK_HOSTS = ("invl.me", "invl.app", "invl.us", "tpx.lu", "stay22.com",
                 "codeaven.com", "yknhc.com", "dbnua.com", "xpuvo.com",
                 "kjuzv.com", "ujhjj.com", "admitad", "travelpayouts")


def check(url, expect):
    try:
        r = requests.get(url, headers={"User-Agent": UA,
                                       "Accept-Language": "en-US,en;q=0.9"},
                         timeout=25, allow_redirects=True)
    except requests.RequestException as e:
        return "fail", f"no connection ({type(e).__name__})", ""
    final = r.url
    host = (urlparse(final).hostname or "").lower()
    code = r.status_code
    if code in BLOCK_CODES:
        return "unclear", f"HTTP {code} (site blocks robots)", final
    if code in (404, 410) or code >= 500:
        return "fail", f"HTTP {code}", final
    if code >= 400:
        return "unclear", f"HTTP {code}", final
    if any(e.lower() in final.lower() for e in expect):
        return "ok", f"HTTP {code}", final
    if any(n in host for n in NETWORK_HOSTS):
        return "unclear", f"stayed on redirect page {host}", final
    return "fail", f"ended on another site: {host}", final


def gh_issue(title, body):
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        print("[issue]", title, "\n", body)
        return
    api = f"https://api.github.com/repos/{repo}/issues"
    h = {"Authorization": f"Bearer {token}",
         "Accept": "application/vnd.github+json"}
    try:
        found = requests.get(api, headers=h, timeout=20,
                             params={"state": "open", "labels": "link-check",
                                     "per_page": 100}).json()
        for issue in found if isinstance(found, list) else []:
            if issue.get("title") == title:
                requests.post(issue["comments_url"], headers=h, timeout=20,
                              json={"body": body})
                return
        requests.post(api, headers=h, timeout=20,
                      json={"title": title, "body": body,
                            "labels": ["link-check"]})
    except requests.RequestException as e:
        print("Could not write issue:", e)


def main():
    data = json.load(open(LINKS_FILE, encoding="utf-8"))
    settings = data.get("settings", {})
    auto = settings.get("auto_switch", False)
    limit = settings.get("fails_to_switch", 2)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    report = [f"## Link check {now}", "",
              f"auto_switch: **{auto}**", "",
              "| Partner | Link | Result | Detail |", "|---|---|---|---|"]

    for p in data["partners"]:
        if not p.get("enabled", True):
            report.append(f"| {p['name']} | — | skipped | disabled |")
            continue
        p.setdefault("fails", {k: 0 for k in ORDER})
        p["last_result"] = {}
        for kind in ORDER:
            url = p["links"].get(kind)
            if not url:
                continue
            res, detail, final = check(url, p.get("expect", []))
            if res == "ok":
                p["fails"][kind] = 0
            elif res == "fail":
                p["fails"][kind] = p["fails"].get(kind, 0) + 1
            p["last_result"][kind] = f"{res}: {detail}"
            report.append(f"| {p['name']} | {kind} | {res} | {detail} |")
        p["last_check"] = now

        available = [k for k in ORDER if p["links"].get(k)]
        down = [k for k in available if p["fails"].get(k, 0) >= limit]
        best = next((k for k in available if k not in down),
                    available[-1] if available else "primary")
        old = p.get("active", "primary")

        if down:
            lines = [f"Partner: **{p['name']}** (`{p['id']}`)", "",
                     "Links that failed several weeks in a row:"]
            for k in down:
                lines.append(f"- {k}: {p['links'][k]} — "
                             f"{p['last_result'].get(k, '')}")
            if best != old:
                if auto:
                    lines.append(f"\nThe app switched from **{old}** to "
                                 f"**{best}** automatically.")
                else:
                    lines.append(f"\nauto_switch is off: the app would switch "
                                 f"from **{old}** to **{best}**.")
            lines.append("\nWhen you add a new working link in links.json, "
                         "close this issue.")
            gh_issue(f"Link problem: {p['name']}", "\n".join(lines))

        if auto and best != old:
            p["active"] = best

    json.dump(data, open(LINKS_FILE, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    text = "\n".join(report)
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
