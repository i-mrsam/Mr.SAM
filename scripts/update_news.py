#!/usr/bin/env python3
"""
update_news.py
--------------
Generates ../news.json (relative to this script) for the live threat ticker
on ai.html. Designed to run inside a GitHub Actions cron workflow, so the
static site never needs to call third-party APIs from the browser
(no rate limits, no CORS issues, no user-controlled XSS input).

Sources (see ai.txt for the curated list):
  1. NVD API 2.0          - latest CVEs matching LLM / AI-security keywords
  2. Simon Willison blog  - prompt-injection tag RSS
  3. The Hacker News RSS  - only AI-related articles

Every source is wrapped in try/except: if one is temporarily down the
feed is still generated from the remaining sources.
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "..", "news.json")

MAX_ITEMS = 15
REQUEST_TIMEOUT = 25
USER_AGENT = "mrsam-news-feed/1.0 (+https://mrsam.me)"

HN_AI_KEYWORDS = re.compile(
    r"\b(AI|A\.I\.|LLM|LLMs|GPT|ChatGPT|OpenAI|Claude|Gemini|Llama|"
    r"Prompt[- ]?Injection|Deepfake|Machine[- ]Learning|Model)\b",
    re.IGNORECASE,
)


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        return resp.read()


def truncate(text: str, limit: int = 110) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


# --------------------------------------------------------------------------
# Source 1: NVD API 2.0 (CVEs related to AI / LLM tooling)
# --------------------------------------------------------------------------
NVD_KEYWORDS = ["LLM", "prompt injection", "PyTorch", "TensorFlow"]


def fetch_nvd() -> list:
    # NVD requires both pubStartDate and pubEndDate with a UTC offset,
    # inside a max 120-day window. Query the last 60 days.
    start = (datetime.now(timezone.utc) - timedelta(days=60)).strftime(
        "%Y-%m-%dT00:00:00.000+00:00"
    )
    end = datetime.now(timezone.utc).strftime("%Y-%m-%dT23:59:59.000+00:00")
    items, seen = [], set()
    for keyword in NVD_KEYWORDS:
        query = urllib.parse.urlencode(
            {
                "keywordSearch": keyword,
                "pubStartDate": start,
                "pubEndDate": end,
                "resultsPerPage": 20,
            }
        )
        url = f"https://services.nvd.nist.gov/rest/json/cves/2.0?{query}"
        try:
            data = json.loads(fetch(url))
        except Exception as exc:  # noqa: BLE001
            print(f"[NVD] keyword={keyword!r} failed: {exc}", file=sys.stderr)
            continue

        for vuln in data.get("vulnerabilities", []):
            cve = vuln.get("cve", {})
            cve_id = cve.get("id")
            if not cve_id or cve_id in seen:
                continue
            seen.add(cve_id)

            description = ""
            for desc in cve.get("descriptions", []):
                if desc.get("lang") == "en":
                    description = desc.get("value", "")
                    break

            items.append(
                {
                    "title": truncate(f"{cve_id}: {description}"),
                    "url": f"https://nvd.nist.gov/vuln/detail/{cve_id}",
                    "date": (cve.get("published") or "")[:10],
                    "source": "NVD",
                    "kind": "cve",
                }
            )

        # Unauthenticated NVD rate limit: ~5 requests / 30 s rolling window.
        time.sleep(7)

    return items


# --------------------------------------------------------------------------
# Feed parser (handles both RSS 2.0 and Atom)
# --------------------------------------------------------------------------
def parse_feed(xml_bytes: bytes) -> list:
    """Return [{'title','link','pubDate'}] for RSS 2.0 and Atom feeds."""
    items = []
    root = ET.fromstring(xml_bytes)
    for node in root.iter():
        tag = node.tag.rsplit("}", 1)[-1]
        if tag not in ("item", "entry"):
            continue
        title = link = pub = ""
        for child in node:
            ctag = child.tag.rsplit("}", 1)[-1]
            if ctag == "title":
                title = (child.text or "").strip()
            elif ctag == "link":
                # Atom stores the URL in href=, RSS in the text body.
                link = (child.get("href") or child.text or "").strip()
            elif ctag in ("pubDate", "published", "updated", "date"):
                if not pub:
                    pub = (child.text or "").strip()
        if title and link:
            items.append({"title": title, "link": link, "pubDate": pub})
    return items


def feed_date_to_iso(pub: str) -> str:
    """Normalize RFC 2822 (RSS) and ISO 8601 (Atom) dates to YYYY-MM-DD."""
    if not pub:
        return ""
    try:
        return parsedate_to_datetime(pub).astimezone(timezone.utc).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(pub.replace("Z", "+00:00")).astimezone(
            timezone.utc
        ).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return ""


# --------------------------------------------------------------------------
# Source 2: Simon Willison - prompt-injection tag (Atom feed)
# --------------------------------------------------------------------------
SIMONWILLISON_ATOM = "https://simonwillison.net/tags/prompt-injection.atom"


def fetch_simonwillison() -> list:
    items = []
    try:
        entries = parse_feed(fetch(SIMONWILLISON_ATOM))
    except Exception as exc:  # noqa: BLE001
        print(f"[SimonWillison] failed: {exc}", file=sys.stderr)
        return items

    for e in entries[:8]:
        items.append(
            {
                "title": truncate(e["title"]),
                "url": e["link"],
                "date": feed_date_to_iso(e["pubDate"]),
                "source": "Simon Willison",
                "kind": "article",
            }
        )
    return items


# --------------------------------------------------------------------------
# Source 3: The Hacker News (AI-related articles only)
# --------------------------------------------------------------------------
def fetch_hackernews() -> list:
    items = []
    try:
        entries = parse_feed(fetch("https://feeds.feedburner.com/TheHackersNews"))
    except Exception as exc:  # noqa: BLE001
        print(f"[HackerNews] failed: {exc}", file=sys.stderr)
        return items

    for e in entries:
        if not HN_AI_KEYWORDS.search(e["title"]):
            continue
        items.append(
            {
                "title": truncate(e["title"]),
                "url": e["link"],
                "date": feed_date_to_iso(e["pubDate"]),
                "source": "The Hacker News",
                "kind": "article",
            }
        )
        if len(items) >= 6:
            break
    return items


# --------------------------------------------------------------------------
# Source 4: CISA Advisories (AI-related advisories only)
# --------------------------------------------------------------------------
def fetch_cisa() -> list:
    items = []
    try:
        entries = parse_feed(fetch("https://www.cisa.gov/cybersecurity-advisories/all.xml"))
    except Exception as exc:  # noqa: BLE001
        print(f"[CISA] failed: {exc}", file=sys.stderr)
        return items

    for e in entries:
        if not HN_AI_KEYWORDS.search(e["title"]):
            continue
        items.append(
            {
                "title": truncate(e["title"]),
                "url": e["link"],
                "date": feed_date_to_iso(e["pubDate"]),
                "source": "CISA",
                "kind": "advisory",
            }
        )
        if len(items) >= 4:
            break
    return items


# --------------------------------------------------------------------------
# Leaderboard: GitHub issues with the "leaderboard" label, dumped to a
# static JSON so the browser no longer hits api.github.com (rate limits).
# --------------------------------------------------------------------------
GITHUB_ISSUES_URL = (
    "https://api.github.com/repos/i-mrsam/MrDexter/issues"
    "?labels=leaderboard&state=all&per_page=100"
)


def write_leaderboard() -> bool:
    path = os.path.join(SCRIPT_DIR, "..", "leaderboard.json")
    try:
        req = urllib.request.Request(
            GITHUB_ISSUES_URL,
            headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"},
        )
        issues = json.loads(urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT).read())
        items = [
            {
                "title": i.get("title", ""),
                "body": i.get("body") or "",
                "created_at": i.get("created_at", ""),
                "url": i.get("html_url", ""),
            }
            for i in issues
            if isinstance(i, dict) and "pull_request" not in i
        ]
        payload = {
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "count": len(items),
            "items": items,
        }
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print(f"Wrote {len(items)} leaderboard entries -> {path}")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[Leaderboard] failed: {exc}", file=sys.stderr)
        return False


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main() -> int:
    all_items = []
    for source_fn in (fetch_nvd, fetch_simonwillison, fetch_hackernews, fetch_cisa):
        try:
            all_items.extend(source_fn())
        except Exception as exc:  # noqa: BLE001
            print(f"[{source_fn.__name__}] unexpected error: {exc}", file=sys.stderr)

    # Keep the newest entries first; de-duplicate identical URLs.
    seen_urls = set()
    deduped = []
    for item in sorted(all_items, key=lambda x: x.get("date") or "", reverse=True):
        if item["url"] in seen_urls:
            continue
        seen_urls.add(item["url"])
        deduped.append(item)

    feed = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "count": len(deduped[:MAX_ITEMS]),
        "items": deduped[:MAX_ITEMS],
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(feed, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"Wrote {feed['count']} items -> {OUTPUT_PATH}")

    # Leaderboard is auxiliary: its failure must not fail the news run.
    write_leaderboard()

    return 0 if feed["count"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
