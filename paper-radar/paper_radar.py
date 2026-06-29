#!/usr/bin/env python3
"""Daily RL + LLM paper radar.

Fetches recent arXiv papers, ranks them with keyword groups, deduplicates via a
small JSON state file, and sends a Slack and/or email digest.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import smtplib
import sys
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import feedparser
import requests
import yaml

ARXIV_API_URL = "https://export.arxiv.org/api/query"


@dataclass
class Paper:
    source: str
    paper_id: str
    title: str
    authors: list[str]
    abstract: str
    published: datetime
    updated: datetime | None
    url: str
    pdf_url: str | None
    categories: list[str]
    score: float = 0.0
    reasons: list[str] | None = None
    interpretation: str = ""
    section: str = ""


def load_yaml(path: str | Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_state(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        return {}
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_state(path: str | Path, state: dict[str, Any]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(p)


def parse_arxiv_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    # arXiv Atom timestamps look like 2026-06-24T12:34:56Z or include offsets.
    value = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(value).astimezone(timezone.utc)
    except ValueError:
        return None


def strip_arxiv_version(arxiv_id: str) -> str:
    return re.sub(r"v\d+$", "", arxiv_id)


def build_arxiv_query(cfg: dict[str, Any]) -> str:
    arxiv_cfg = cfg.get("arxiv", {})
    categories = arxiv_cfg.get("categories", ["cs.CL", "cs.LG", "cs.AI", "stat.ML"])
    lookback_days = int(arxiv_cfg.get("lookback_days", 7))

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=lookback_days)

    def fmt(dt: datetime) -> str:
        return dt.strftime("%Y%m%d%H%M")

    cat_query = " OR ".join(f"cat:{c}" for c in categories)
    date_query = f"submittedDate:[{fmt(start)} TO {fmt(now)}]"
    return f"({cat_query}) AND {date_query}"


def fetch_arxiv(cfg: dict[str, Any]) -> list[Paper]:
    arxiv_cfg = cfg.get("arxiv", {})
    max_results = int(arxiv_cfg.get("max_results", 300))
    query = build_arxiv_query(cfg)
    params = {
        "search_query": query,
        "start": 0,
        "max_results": max_results,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    }
    headers = {
        "User-Agent": arxiv_cfg.get("user_agent", "rl-paper-radar/0.1 mailto:you@example.com")
    }

    response = requests.get(ARXIV_API_URL, params=params, headers=headers, timeout=45)
    response.raise_for_status()
    feed = feedparser.parse(response.text)
    if getattr(feed, "bozo", False):
        # feedparser is conservative; keep going but surface the issue.
        print(f"Warning: feedparser reported: {getattr(feed, 'bozo_exception', '')}", file=sys.stderr)

    papers: list[Paper] = []
    for entry in feed.entries:
        raw_id = entry.get("id", "")
        arxiv_id = raw_id.rstrip("/").split("/")[-1]
        paper_id = strip_arxiv_version(arxiv_id)
        title = clean_text(entry.get("title", ""))
        abstract = clean_text(entry.get("summary", ""))
        authors = [a.get("name", "") for a in entry.get("authors", []) if a.get("name")]
        categories = [t.get("term", "") for t in entry.get("tags", []) if t.get("term")]
        published = parse_arxiv_datetime(entry.get("published")) or datetime.now(timezone.utc)
        updated = parse_arxiv_datetime(entry.get("updated"))
        pdf_url = None
        for link in entry.get("links", []):
            if link.get("title") == "pdf" or link.get("type") == "application/pdf":
                pdf_url = link.get("href")
                break
        url = entry.get("link") or raw_id or urljoin("https://arxiv.org/abs/", paper_id)
        papers.append(
            Paper(
                source="arXiv",
                paper_id=paper_id,
                title=title,
                authors=authors,
                abstract=abstract,
                published=published,
                updated=updated,
                url=url,
                pdf_url=pdf_url,
                categories=categories,
            )
        )
    return papers


def clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def contains_term(text: str, term: str) -> bool:
    t = term.lower().strip()
    if not t:
        return False
    # For acronyms, use word boundaries. For phrases, substring is okay.
    if re.fullmatch(r"[a-z0-9+-]{2,12}", t):
        return re.search(rf"(?<![a-z0-9]){re.escape(t)}(?![a-z0-9])", text) is not None
    return t in text


def score_paper(paper: Paper, cfg: dict[str, Any]) -> Paper:
    ranking = cfg.get("ranking", {})
    groups = ranking.get("groups", {})
    text = " ".join([paper.title, paper.abstract, " ".join(paper.categories)]).lower()
    score = 0.0
    reasons: list[str] = []
    group_hits: dict[str, list[str]] = {}

    for group_name, group_cfg in groups.items():
        weight = float(group_cfg.get("weight", 1.0))
        terms = group_cfg.get("terms", [])
        hits = [term for term in terms if contains_term(text, term)]
        if hits:
            # Cap repeated hits per group so verbose abstracts do not dominate.
            capped = hits[:3]
            score += weight * len(capped)
            group_hits[group_name] = capped
            reasons.extend(f"{group_name}:{h}" for h in capped)

    negative_terms = ranking.get("negative_terms", [])
    for term in negative_terms:
        if contains_term(text, term):
            score -= 1.0
            reasons.append(f"downrank:{term}")

    # Small recency bonus.
    age_days = (datetime.now(timezone.utc) - paper.published).total_seconds() / 86400
    if age_days <= 2:
        score += 0.5

    paper.score = round(score, 2)
    paper.reasons = reasons
    paper._group_hits = group_hits  # type: ignore[attr-defined]
    return paper


def keep_paper(paper: Paper, cfg: dict[str, Any]) -> bool:
    ranking = cfg.get("ranking", {})
    threshold = float(ranking.get("score_threshold", 4.0))
    required = set(ranking.get("require_one_group", []))
    required_sets = ranking.get("require_all_group_sets", [])
    group_hits = getattr(paper, "_group_hits", {})
    hit_groups = set(group_hits.keys())
    text = " ".join([paper.title, paper.abstract, " ".join(paper.categories)]).lower()
    if paper.score < threshold:
        return False
    # Unlike negative_terms (which merely downrank), these are hard topic
    # boundaries.  They are useful when a section must not include a modality.
    if any(contains_term(text, term) for term in ranking.get("exclude_terms", [])):
        return False
    if set(ranking.get("exclude_any_groups", [])) & hit_groups:
        return False
    if required and not (required & hit_groups):
        return False
    for group_set in required_sets:
        required_group_set = set(group_set or [])
        if required_group_set and not (required_group_set & hit_groups):
            return False
    return True


def rank_and_filter(
    papers: list[Paper],
    cfg: dict[str, Any],
    state: dict[str, Any],
    excluded_ids: set[str] | None = None,
) -> list[Paper]:
    """Select a topic's papers without mutating papers used by other topics."""
    seen = {k for k in state.keys() if not k.startswith("_")}
    excluded = seen | (excluded_ids or set())
    # A paper is scored independently for every topic.  This preserves the
    # score/reasons shown for an earlier topic when a later topic is evaluated.
    scored = [score_paper(replace(p), cfg) for p in papers]
    kept = [p for p in scored if keep_paper(p, cfg) and p.paper_id not in excluded]
    kept.sort(key=lambda p: (p.score, p.published), reverse=True)
    top_k = int(cfg.get("ranking", {}).get("top_k", 12))
    return kept[:top_k]


def rank_topic_sections(
    papers: list[Paper], cfg: dict[str, Any], state: dict[str, Any]
) -> list[tuple[str, list[Paper]]]:
    """Rank configured sections in order, reserving each paper for one section.

    `topics` is intentionally ordered: a paper matching several topics appears
    in the first matching section only.  A legacy single `ranking` configuration
    still works, which keeps existing user configs compatible.
    """
    topics = cfg.get("topics")
    if not topics:
        return [("精选论文", rank_and_filter(papers, cfg, state))]

    selected_ids: set[str] = set()
    sections: list[tuple[str, list[Paper]]] = []
    for topic in topics:
        if not isinstance(topic, dict):
            continue
        ranking = topic.get("ranking", {})
        topic_cfg = {**cfg, "ranking": ranking}
        title = str(topic.get("title", "未命名栏目"))
        selected = rank_and_filter(papers, topic_cfg, state, selected_ids)
        for paper in selected:
            paper.section = title
        selected_ids.update(p.paper_id for p in selected)
        sections.append((title, selected))
    return sections


def _build_llm_prompt(paper: Paper, language: str) -> tuple[str, str]:
    if language == "en":
        system = (
            "You are an assistant helping a researcher quickly understand recent AI "
            "papers. Be concise, concrete, and information-dense."
        )
        user = (
            f"Section: {paper.section or 'AI research'}\nTitle: {paper.title}\n\n"
            f"Abstract: {paper.abstract}\n\n"
            "In 3-4 sentences, explain: the core contribution, the method/approach, "
            "and why it matters for this section. Do not repeat the abstract verbatim."
        )
    else:
        system = (
            "你是帮助研究者快速理解最新 AI 论文的助手，回答要简洁、具体、有信息量。"
        )
        user = (
            f"所属栏目：{paper.section or 'AI 研究'}\n标题：{paper.title}\n\n摘要：{paper.abstract}\n\n"
            "请用中文 3-4 句话解读：这篇论文的核心贡献、采用的方法/思路，"
            "以及它对这个栏目为什么值得关注。不要照抄摘要原文。"
        )
    return system, user


def _interpret_anthropic(paper: Paper, llm_cfg: dict[str, Any], language: str) -> str:
    import anthropic  # lazy: only needed when the LLM pass is enabled

    model = llm_cfg.get("anthropic", {}).get("model", "claude-opus-4-8")
    max_tokens = int(llm_cfg.get("max_tokens", 600))
    system, user = _build_llm_prompt(paper, language)
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def _interpret_openai(paper: Paper, llm_cfg: dict[str, Any], language: str) -> str:
    from openai import OpenAI  # lazy: only needed when the LLM pass is enabled

    model = llm_cfg.get("openai", {}).get("model", "gpt-5.4")
    max_tokens = int(llm_cfg.get("max_tokens", 600))
    system, user = _build_llm_prompt(paper, language)
    client = OpenAI()  # reads OPENAI_API_KEY from the environment
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    # Newer OpenAI models (gpt-5 era) require max_completion_tokens and reject the
    # legacy max_tokens; older ones only accept max_tokens. Try the new name first.
    try:
        resp = client.chat.completions.create(
            model=model, messages=messages, max_completion_tokens=max_tokens
        )
    except Exception as exc:  # noqa: BLE001 - narrow retry on the param-name mismatch
        if "max_tokens" in str(exc) or "max_completion_tokens" in str(exc):
            resp = client.chat.completions.create(
                model=model, messages=messages, max_tokens=max_tokens
            )
        else:
            raise
    return (resp.choices[0].message.content or "").strip()


def interpret_paper(paper: Paper, cfg: dict[str, Any]) -> str:
    """Return an LLM interpretation of the paper, or "" if disabled or on error."""
    llm_cfg = cfg.get("llm", {})
    if not llm_cfg.get("enabled", False):
        return ""
    provider = str(llm_cfg.get("provider", "anthropic")).lower()
    language = str(llm_cfg.get("language", "zh")).lower()
    try:
        if provider == "openai":
            return _interpret_openai(paper, llm_cfg, language)
        return _interpret_anthropic(paper, llm_cfg, language)
    except Exception as exc:  # missing key/dep, rate limit, etc. — never block the digest
        print(f"LLM interpretation failed for {paper.paper_id}: {exc}", file=sys.stderr)
        return ""


_SHARED_CSS = """\
*{{box-sizing:border-box;margin:0;padding:0}}
:root{{
  --bg:#F4F2EC; --surface:#FFFFFF; --surface-2:#FBFAF6;
  --ink:#1A1915; --ink-2:#57544B; --ink-3:#8A867A;
  --accent:#CC785C; --accent-deep:#A8512F;
  --border:#E4E0D4; --border-2:#D6D1C2; --tint:#F2EAE2;
  --serif:"Tiempos Headline",ui-serif,"Iowan Old Style","Palatino Linotype",Palatino,Georgia,Cambria,"Times New Roman",serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
}}
html{{scroll-behavior:smooth}}
body{{
  font-family:var(--sans); color:var(--ink); line-height:1.7; -webkit-font-smoothing:antialiased;
  padding:0 20px 80px; background-color:var(--bg);
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E");
}}
body::before{{
  content:""; position:fixed; top:0; left:0; right:0; height:3px; z-index:50;
  background:linear-gradient(90deg,var(--accent),#E2A98E,var(--accent-deep));
}}
.container{{max-width:760px;margin:0 auto}}
a{{color:var(--accent)}}
/* ---- Editorial header ---- */
.hero{{max-width:760px; margin:0 auto; padding:64px 0 32px}}
.eyebrow{{
  display:inline-block; font-size:.74rem; font-weight:600; letter-spacing:.14em;
  text-transform:uppercase; color:var(--accent); margin-bottom:20px;
}}
.hero h1{{
  font-family:var(--serif); font-weight:600; font-size:2.7rem; line-height:1.1;
  letter-spacing:-.018em; color:var(--ink); margin-bottom:16px;
}}
.hero .sub{{color:var(--ink-2); font-size:1rem; font-weight:400}}
.hero .sub b{{color:var(--ink); font-weight:600}}
.rule{{max-width:760px; margin:0 auto 40px; border:none; border-top:1px solid var(--border)}}
/* ---- Nav ---- */
.nav{{margin-bottom:40px}}
.nav a{{
  font-size:.88rem; text-decoration:none; color:var(--ink-2); transition:color .15s;
}}
.nav a:hover{{color:var(--accent)}}
.digest-layout{{display:grid; gap:24px}}
.toc{{display:flex; gap:8px; overflow-x:auto; padding:12px; border:1px solid var(--border); border-radius:10px; background:var(--surface-2)}}
.toc-label{{flex:none; padding:7px 8px; color:var(--ink-3); font-size:.72rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase}}
.toc a{{display:flex; align-items:baseline; gap:7px; flex:none; padding:7px 10px; border-radius:7px; color:var(--ink-2); font-size:.86rem; line-height:1.25; text-decoration:none; transition:background .15s,color .15s}}
.toc a:hover{{background:var(--tint); color:var(--accent-deep)}}
.toc a span{{color:var(--accent); font-family:var(--serif); font-size:1rem; font-weight:600}}
.toc a b{{color:var(--ink-3); font-size:.72rem; font-weight:500}}
.digest-content{{min-width:0}}
.topic{{background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:28px 30px; box-shadow:0 2px 10px rgba(39,34,23,.025)}}
.topic + .topic{{margin-top:28px}}
.topic-head{{display:flex; justify-content:space-between; align-items:baseline; gap:16px; margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid var(--border)}}
.topic-title{{font-family:var(--serif); font-size:1.75rem; font-weight:600; line-height:1.2; letter-spacing:-.012em}}
.topic-count{{flex:none; color:var(--accent); font-size:.9rem; font-weight:600}}
.topic .topic-head + .paper{{border-top:none; padding-top:0}}
.topic-empty{{text-align:left; padding:14px 0 22px}}
.empty{{color:var(--ink-2); text-align:center; padding:72px 0; font-size:1.05rem}}
.empty .big{{font-family:var(--serif); font-size:2rem; color:var(--ink-3); margin-bottom:10px}}
/* ---- Paper as article ---- */
.paper{{
  position:relative; padding:32px 0; border-top:1px solid var(--border);
}}
.paper:first-of-type{{border-top:none; padding-top:0}}
.p-head{{display:flex; gap:16px; align-items:baseline; margin-bottom:14px}}
.idx{{
  flex:none; font-family:var(--serif); font-size:2.1rem; font-weight:600;
  color:#D8A286; line-height:1; min-width:1em;
}}
.paper-title{{font-family:var(--serif); font-size:1.5rem; font-weight:600; line-height:1.28; letter-spacing:-.012em}}
.paper-title a{{color:var(--ink); text-decoration:none; transition:color .15s}}
.paper-title a:hover{{color:var(--accent)}}
.meta-line{{font-size:.8rem; color:var(--ink-2); margin:0 0 11px 0}}
.meta-line .sep{{margin:0 9px; color:var(--border-2)}}
.score{{font-weight:600; color:var(--accent)}}
.score.hot{{color:var(--accent-deep)}}
.tags{{display:flex; flex-wrap:wrap; gap:7px; margin:0 0 16px 0}}
.tag{{font-size:.72rem; font-weight:600; letter-spacing:.02em; padding:3px 11px; border-radius:999px}}
.tag.c0{{color:#A8512F; background:#F1E2D9}}
.tag.c1{{color:#5E6B39; background:#E8EAD9}}
.tag.c2{{color:#4D7287; background:#DEE8ED}}
.tag.c3{{color:#94712C; background:#EFE6CE}}
.tag.c4{{color:#855272; background:#EDE0E7}}
.meta-row{{font-size:.92rem; color:var(--ink-2); margin:0 0 4px 0}}
.why{{
  font-size:.82rem; color:var(--ink-3); margin:0 0 20px 0; font-style:italic;
}}
.section-label{{
  font-family:var(--sans); font-size:.72rem; font-weight:700; text-transform:uppercase;
  letter-spacing:.1em; color:var(--ink-3); margin:0 0 8px 0;
}}
.abstract{{
  font-size:1rem; color:var(--ink); margin:0 0 22px 0; white-space:pre-wrap; line-height:1.75;
}}
.interp{{
  font-size:1rem; color:var(--ink); white-space:pre-wrap; line-height:1.78;
  background:var(--tint); border-left:3px solid var(--accent);
  padding:18px 22px; border-radius:2px 10px 10px 2px;
}}
.interp .section-label{{color:var(--accent-deep)}}
.links{{display:flex; gap:20px; margin:20px 0 0 0}}
.links a{{
  font-size:.9rem; font-weight:500; text-decoration:none; color:var(--accent);
}}
.links a:hover{{color:var(--accent-deep); text-decoration:underline}}
footer{{
  max-width:760px; margin:64px auto 0; padding-top:28px; border-top:1px solid var(--border);
  font-size:.84rem; color:var(--ink-3); display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px;
}}
footer a{{color:var(--ink-3); text-decoration:none}} footer a:hover{{color:var(--accent)}}
@media(max-width:560px){{
  .hero{{padding:44px 0 24px}} .hero h1{{font-size:2rem}}
  .paper-title{{font-size:1.28rem}}
  .topic{{padding:22px 20px}}
}}
@media(min-width:980px){{
  .daily-container{{max-width:1030px}}
  .digest-layout{{grid-template-columns:205px minmax(0,1fr); align-items:start; gap:32px}}
  .toc{{position:sticky; top:24px; display:flex; flex-direction:column; overflow:visible; padding:12px}}
  .toc a{{justify-content:flex-start}}
}}
"""

_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · {date}</title>
<style>
""" + _SHARED_CSS + """\
</style>
</head>
<body>
<div class="hero">
  <span class="eyebrow">Daily Radar</span>
  <h1>{title}</h1>
  <div class="sub"><b>{date}</b> &nbsp;·&nbsp; {count} 篇精选论文</div>
</div>
<hr class="rule">
<div class="container daily-container">
<nav class="nav">{nav_links}</nav>
<div class="digest-layout">
  <aside class="toc" aria-label="论文栏目目录">
    {toc_links}
  </aside>
  <main class="digest-content">
    {body}
  </main>
</div>
</div>
<footer>
  <span>Generated by Zhisheng Zheng · {date}</span>
  <a href="index.html">查看全部归档 →</a>
</footer>
</body>
</html>"""

_INDEX_TEMPLATE = """\
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · Archive</title>
<style>
""" + _SHARED_CSS + """\
.arc{{display:flex; flex-direction:column}}
.entry{{
  display:flex; justify-content:space-between; align-items:baseline; gap:16px;
  padding:22px 0; border-top:1px solid var(--border); text-decoration:none; transition:padding-left .18s;
}}
.entry:first-child{{border-top:none}}
.entry:hover{{padding-left:8px}}
.entry:hover .day{{color:var(--accent)}}
.entry .day{{font-family:var(--serif); font-size:1.4rem; font-weight:600; color:var(--ink); letter-spacing:-.01em; transition:color .15s}}
.entry .day small{{font-family:var(--sans); font-size:.82rem; font-weight:500; color:var(--ink-3); margin-left:10px}}
.pill{{flex:none; font-size:.88rem; font-weight:600; color:var(--accent)}}
.pill.zero{{color:var(--ink-3); font-weight:400}}
.entry:hover .pill::after{{content:" →"}}
</style>
</head>
<body>
<div class="hero">
  <span class="eyebrow">Archive</span>
  <h1>{title}</h1>
  <div class="sub">共 <b>{total_days}</b> 天归档 · 累计 <b>{total_papers}</b> 篇论文</div>
</div>
<hr class="rule">
<div class="container">
<div class="arc">
{entries}
</div>
</div>
<footer><span>Generated by Zhisheng Zheng</span></footer>
</body>
</html>"""

_WEEKDAYS_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def _html_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _score_class(score: float) -> str:
    """High scorers get the deeper clay tone to stand out."""
    return "score hot" if score >= 9 else "score"


def _cat_class(cat: str) -> str:
    """Map a category to one of five soft chip colors, stably."""
    return "c" + str(sum(ord(ch) for ch in cat) % 5)


def _format_html_paper(paper: Paper, index: int, cfg: dict[str, Any]) -> str:
    """Render one paper card for a section in the HTML digest."""
    notif = cfg.get("notifications", {})
    full_abstract = bool(notif.get("full_abstract", False))
    abstract_chars = int(notif.get("include_abstract_chars", 420))
    authors = ", ".join(paper.authors[:5]) + (" et al." if len(paper.authors) > 5 else "")
    cats = "".join(
        f'<span class="tag {_cat_class(c)}">{_html_escape(c)}</span>'
        for c in paper.categories[:4]
    )
    reasons = ", ".join((paper.reasons or [])[:6])
    if full_abstract:
        abstract = paper.abstract
    else:
        abstract = paper.abstract[:abstract_chars]
        if len(paper.abstract) > abstract_chars:
            abstract += "..."
    interp_block = ""
    if paper.interpretation:
        interp_block = (
            '<div class="section-label">解读</div>'
            f'<div class="interp">{_html_escape(paper.interpretation)}</div>'
        )
    pdf_btn = ""
    if paper.pdf_url:
        pdf_btn = f'<a class="btn" href="{_html_escape(paper.pdf_url)}" target="_blank">PDF</a>'
    return f"""<div class="paper">
  <div class="p-head">
    <span class="idx">{index}</span>
    <div class="paper-title"><a href="{_html_escape(paper.url)}" target="_blank">{_html_escape(paper.title)}</a></div>
  </div>
  <div class="meta-line"><span class="{_score_class(paper.score)}">score {paper.score}</span><span class="sep">·</span><span>{paper.published.date()}</span></div>
  <div class="tags">{cats}</div>
  <div class="meta-row">{_html_escape(authors)}</div>
  <div class="why">why: {_html_escape(reasons)}</div>
  <div class="section-label">Abstract</div>
  <div class="abstract">{_html_escape(abstract)}</div>
  {interp_block}
  <div class="links">
    <a class="btn primary" href="{_html_escape(paper.url)}" target="_blank">arXiv ↗</a>
    {pdf_btn}
  </div>
</div>"""


def format_html_digest(
    sections: list[tuple[str, list[Paper]]], cfg: dict[str, Any], date: str
) -> str:
    title = _html_escape(cfg.get("notifications", {}).get("title", "Paper Radar"))
    total = sum(len(papers) for _, papers in sections)

    parts: list[str] = []
    for section_index, (section_title, papers) in enumerate(sections, start=1):
        cards = "\n".join(
            _format_html_paper(paper, index, cfg)
            for index, paper in enumerate(papers, start=1)
        )
        if not cards:
            cards = '<div class="empty topic-empty">本栏目今日没有新的匹配论文。</div>'
        parts.append(
            f'<section class="topic" id="section-{section_index}">'
            '<div class="topic-head">'
            f'<h2 class="topic-title">{_html_escape(section_title)}</h2>'
            f'<span class="topic-count">{len(papers)} 篇</span>'
            "</div>"
            f"{cards}</section>"
        )
    body = "\n".join(parts)
    if not body:
        body = '<div class="empty"><div class="big">—</div>今日没有新的匹配论文。</div>'

    toc_items = [
        '<span class="toc-label">目录</span>'
    ]
    for section_index, (section_title, papers) in enumerate(sections, start=1):
        toc_items.append(
            f'<a href="#section-{section_index}">'
            f'<span>{section_index}</span>{_html_escape(section_title)}'
            f'<b>{len(papers)} 篇</b></a>'
        )

    return _HTML_TEMPLATE.format(
        title=title,
        date=date,
        count=total,
        nav_links='<a href="index.html">← 全部归档</a>',
        toc_links="\n    ".join(toc_items),
        body=body,
    )


def _weekday_label(day: str) -> str:
    """Return a Chinese weekday label for a YYYY-MM-DD string, or ""."""
    try:
        d = datetime.strptime(day, "%Y-%m-%d")
        return _WEEKDAYS_ZH[d.weekday()]
    except ValueError:
        return ""


def save_html_digest(
    sections: list[tuple[str, list[Paper]]],
    cfg: dict[str, Any],
    date: str,
    html_dir: str | Path,
) -> Path:
    out_dir = Path(html_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    html = format_html_digest(sections, cfg, date)
    out_file = out_dir / f"{date}.html"
    tmp = out_file.with_suffix(".tmp")
    tmp.write_text(html, encoding="utf-8")
    tmp.replace(out_file)

    # Rebuild index.html from all dated files in the directory.
    title = _html_escape(cfg.get("notifications", {}).get("title", "Paper Radar"))
    dated_files = sorted(out_dir.glob("????-??-??.html"), reverse=True)
    entries_html = ""
    total_papers = 0
    for f in dated_files:
        day = f.stem
        # Count papers from the file (rough: count paper cards).
        content = f.read_text(encoding="utf-8")
        n = content.count('class="paper"')
        total_papers += n
        wd = _weekday_label(day)
        wd_html = f"<small>{wd}</small>" if wd else ""
        pill_cls = "pill" if n else "pill zero"
        count_str = f"{n} 篇" if n else "无新论文"
        entries_html += (
            f'<a class="entry" href="{day}.html">'
            f'<span class="day">{day}{wd_html}</span>'
            f'<span class="{pill_cls}">{count_str}</span></a>\n'
        )
    index_html = _INDEX_TEMPLATE.format(
        title=title,
        entries=entries_html or '<div class="empty">No digests yet.</div>',
        total_days=len(dated_files),
        total_papers=total_papers,
    )
    index_file = out_dir / "index.html"
    tmp_idx = index_file.with_suffix(".tmp")
    tmp_idx.write_text(index_html, encoding="utf-8")
    tmp_idx.replace(index_file)

    return out_file


def format_digest(sections: list[tuple[str, list[Paper]]], cfg: dict[str, Any]) -> str:
    title = cfg.get("notifications", {}).get("title", "Paper Radar")
    date = datetime.now().strftime("%Y-%m-%d")
    total = sum(len(papers) for _, papers in sections)
    if not total:
        return f"*{title}* - {date}\nNo new matching papers."

    notif = cfg.get("notifications", {})
    full_abstract = bool(notif.get("full_abstract", False))
    abstract_chars = int(notif.get("include_abstract_chars", 420))
    lines = [f"*{title}* - {date}", f"Found {total} new matching papers.\n"]
    for section_title, papers in sections:
        lines.append(f"*{section_title}*（{len(papers)} 篇）")
        if not papers:
            lines.extend(["   本栏目今日没有新的匹配论文。", ""])
            continue
        for i, p in enumerate(papers, start=1):
            authors = ", ".join(p.authors[:4]) + (" et al." if len(p.authors) > 4 else "")
            cats = ", ".join(p.categories[:4])
            reasons = ", ".join((p.reasons or [])[:6])
            if full_abstract:
                abstract = p.abstract.rstrip()
            else:
                abstract = p.abstract[:abstract_chars].rstrip()
                if len(p.abstract) > abstract_chars:
                    abstract += "..."
            lines.extend(
                [
                    f"{i}. *{p.title}*",
                    f"   score={p.score} | {p.source}:{p.paper_id} | {p.published.date()} | {cats}",
                    f"   authors: {authors}",
                    f"   why: {reasons}",
                    f"   {p.url}",
                    f"   abstract: {abstract}",
                ]
            )
            if p.interpretation:
                lines.append(f"   解读: {p.interpretation}")
            lines.append("")
    return "\n".join(lines)


def send_slack(text: str) -> None:
    webhook = os.getenv("SLACK_WEBHOOK_URL", "").strip()
    if not webhook:
        print("SLACK_WEBHOOK_URL not set; skipping Slack send.", file=sys.stderr)
        return
    resp = requests.post(webhook, json={"text": text}, timeout=30)
    resp.raise_for_status()


def send_email(text: str, cfg: dict[str, Any]) -> None:
    host = os.getenv("SMTP_HOST", "").strip()
    port = int(os.getenv("SMTP_PORT", "465"))
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    mail_from = os.getenv("EMAIL_FROM", username).strip()
    mail_to = [x.strip() for x in os.getenv("EMAIL_TO", "").split(",") if x.strip()]
    if not all([host, username, password, mail_from]) or not mail_to:
        print("SMTP/EMAIL env vars incomplete; skipping email send.", file=sys.stderr)
        return

    subject_prefix = cfg.get("notifications", {}).get("title", "Paper Radar")
    msg = EmailMessage()
    msg["Subject"] = f"{subject_prefix} - {datetime.now().strftime('%Y-%m-%d')}"
    msg["From"] = mail_from
    msg["To"] = ", ".join(mail_to)
    msg.set_content(text.replace("*", ""))

    with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
        smtp.login(username, password)
        smtp.send_message(msg)


def update_state(state: dict[str, Any], papers: list[Paper]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    meta = state.get("_meta")
    for p in papers:
        state[p.paper_id] = {
            "seen_at": now,
            "title": p.title,
            "source": p.source,
            "url": p.url,
            "score": p.score,
        }
    # Keep state reasonably small, but never evict reserved metadata keys.
    paper_items = [(k, v) for k, v in state.items() if k != "_meta"]
    trimmed = dict(paper_items[-5000:])
    if meta is not None:
        trimmed["_meta"] = meta
    return trimmed


def should_run_now(cfg: dict[str, Any]) -> tuple[bool, str]:
    """Gate execution to a local-time window.

    The GitHub Actions cron is UTC-only, so the workflow triggers at a couple of
    UTC times and this guard lets the job proceed only at the configured local
    hour on weekdays. That keeps "weekday, local time" correct year-round even
    across daylight-saving changes.
    """
    sched = cfg.get("schedule", {})
    tz_name = sched.get("timezone", "America/Los_Angeles")
    weekdays_only = bool(sched.get("weekdays_only", True))
    run_hour = sched.get("run_hour")
    try:
        now_local = datetime.now(ZoneInfo(tz_name))
    except Exception as exc:  # unknown tz name or missing tz database
        return True, f"Schedule check skipped ({exc})."
    if weekdays_only and now_local.weekday() >= 5:
        return False, f"Skipping: {now_local:%A} is a weekend in {tz_name}."
    if run_hour is not None and now_local.hour != int(run_hour):
        return False, (
            f"Skipping: local time is {now_local:%H:%M} {tz_name}; "
            f"waiting for hour {int(run_hour):02d}."
        )
    return True, ""


def local_today(cfg: dict[str, Any]) -> tuple[str, str]:
    """Return ("YYYY-MM-DD", tz_name) for the current day in the configured tz."""
    tz_name = cfg.get("schedule", {}).get("timezone", "America/Los_Angeles")
    try:
        now_local = datetime.now(ZoneInfo(tz_name))
    except Exception:  # unknown tz name or missing tz database
        now_local = datetime.now()
    return now_local.strftime("%Y-%m-%d"), tz_name


def already_ran_today(state: dict[str, Any], cfg: dict[str, Any]) -> bool:
    """Whether a digest has already been generated for today (local time)."""
    today, _ = local_today(cfg)
    return state.get("_meta", {}).get("last_run_date") == today


def mark_ran_today(state: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    """Record that today's digest has been generated, in the state metadata."""
    today, _ = local_today(cfg)
    meta = dict(state.get("_meta", {}))
    meta["last_run_date"] = today
    meta["last_run_at"] = datetime.now(timezone.utc).isoformat()
    state["_meta"] = meta
    return state


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--state", default="state/seen.json")
    parser.add_argument("--dry-run", action="store_true", help="print digest but do not send notifications or update state")
    parser.add_argument("--manual", action="store_true", help="run now (skip the local-time window) but only if today's digest has not been generated yet")
    parser.add_argument("--force", action="store_true", help="run unconditionally, even outside the time window or if today's digest already ran")
    parser.add_argument("--html-dir", default=None, help="save daily HTML digest to this directory (overrides config)")
    args = parser.parse_args()

    cfg = load_yaml(args.config)
    state = load_state(args.state)

    if not (args.dry_run or args.force):
        # At most one digest per local day. A manual run that finds today already
        # done does nothing; a scheduled run additionally waits for the local hour.
        if already_ran_today(state, cfg):
            today, tz_name = local_today(cfg)
            print(
                f"Today's digest ({today} {tz_name}) was already generated; "
                f"nothing to do. Use --force to re-send."
            )
            return 0
        if not args.manual:
            ok, reason = should_run_now(cfg)
            if not ok:
                print(reason)
                return 0

    papers = fetch_arxiv(cfg)
    sections = rank_topic_sections(papers, cfg, state)
    selected = [paper for _, section_papers in sections for paper in section_papers]
    for p in selected:
        p.interpretation = interpret_paper(p, cfg)

    notifications = cfg.get("notifications", {})
    html_dir = args.html_dir or notifications.get("html_dir")
    any_channel = (
        notifications.get("slack_enabled", True)
        or notifications.get("email_enabled", False)
        or bool(html_dir)
    )
    digest = format_digest(sections, cfg)
    # Print to terminal only when there is no other destination, or in dry-run mode.
    if args.dry_run or not any_channel:
        print(digest)

    if args.dry_run:
        return 0

    if notifications.get("slack_enabled", True):
        send_slack(digest)
    if notifications.get("email_enabled", False):
        send_email(digest, cfg)

    if html_dir:
        date_str, _ = local_today(cfg)
        out_path = save_html_digest(sections, cfg, date_str, html_dir)
        print(f"HTML digest saved: {out_path}", file=sys.stderr)

    # Record the run (even with no new papers) so today counts as generated.
    new_state = update_state(state, selected)
    new_state = mark_ran_today(new_state, cfg)
    save_state(args.state, new_state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
