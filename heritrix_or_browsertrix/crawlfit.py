#!/usr/bin/env python3
"""
crawlfit: Recommend Heritrix vs Browsertrix for a domain.

Architecture:
  1. Discover URLs using sitemaps first.
  2. If sitemaps are shallow, enrich discovery with mixed low-fidelity static crawling and high-fidelity rendered crawling.
  3. Stratified sample across homepage, sections, depth bands, pagination, deepest pages, random remainder.
  3. Fetch raw HTML with normal HTTP.
  4. Optionally render pages with Playwright.
  5. Compare raw vs rendered page evidence.
  6. Recommend Heritrix, Browsertrix, or Hybrid.

Install static mode:
  python3 -m pip install requests beautifulsoup4 lxml

Install render comparison mode:
  python3 -m pip install requests beautifulsoup4 lxml playwright
  python3 -m playwright install chromium

Examples:
  chmod +x crawlfit.py
  ./crawlfit.py example.org
  ./crawlfit.py domains.txt
  ./crawlfit.py domains.txt --quiet --tsv > heritrix_or_browsertrix.lst
  ./crawlfit.py domains.txt --quiet --json > crawlfit-batch.json
  ./crawlfit.py example.org --max-pages 5000 --max-samples 150 --render-pages 30
  ./crawlfit.py example.org --report-dir crawlfit-report
"""

from __future__ import annotations

import argparse
import collections
import copy
import concurrent.futures
import csv
import dataclasses
import difflib
import html
import json
import math
import os
import random
import re
import shutil
import statistics
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Optional

import requests
from bs4 import BeautifulSoup
from xml.etree import ElementTree as ET


VERSION = "4.2"
UA = f"crawlfit/{VERSION} (+https://example.invalid/crawlfit; crawl method analysis)"
HTML_CT_RE = re.compile(r"(text/html|application/xhtml\+xml)", re.I)
ASSET_RE = re.compile(r"\.(css|js|png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|mp4|mp3|woff2?|ttf|eot)(\?.*)?$", re.I)
JS_FRAMEWORK_RE = re.compile(r"(next-data|__NEXT_DATA__|gatsby|nuxt|webpackJsonp|vite|react|vue|angular|svelte|ember|hydration|data-reactroot)", re.I)
CLIENT_APP_RE = re.compile(r"(id=['\"]root['\"]|id=['\"]app['\"]|ng-app|data-reactroot|__NEXT_DATA__|window\.__|<main[^>]*>\s*</main>)", re.I | re.S)
API_HINT_RE = re.compile(r"(/api/|graphql|fetch\(|axios\.|XMLHttpRequest|application/json)", re.I)
BOT_BLOCK_RE = re.compile(r"(captcha|cloudflare|access denied|enable javascript|checking your browser|akamai|datadome|perimeterx)", re.I)
PAGINATION_RE = re.compile(r"(page=|/page/|p=\d+|offset=|cursor=|next|pagination)", re.I)
BOILERPLATE_WS_RE = re.compile(r"\s+")


class DualProgress:
    """
    Shared live display for batch mode.

    It keeps four terminal lines updated in place:
      Overall [bar] ...
      Current: domain
      Stage [bar] ...
      Newest URL: url

    stdout remains clean when stream=sys.stderr.
    """
    def __init__(self, stream=None, quiet: bool = False):
        self.stream = stream if stream is not None else sys.stderr
        self.quiet = quiet
        self._tty = self.stream.isatty() and not quiet
        self._active = False
        self.overall_line1 = "Overall [-]"
        self.overall_line2 = "Current: -"
        self.site_line1 = "Stage [-]"
        self.site_line2 = "Newest URL: -"

    def _term_width(self) -> int:
        return shutil.get_terminal_size((120, 24)).columns

    def _truncate(self, value: str, width: int) -> str:
        value = value or ""
        if len(value) <= width:
            return value
        return value[: max(0, width - 1)] + "…"

    def update(self, role: str, line1: str, line2: str) -> None:
        if self.quiet:
            return

        if role == "overall":
            self.overall_line1 = line1
            self.overall_line2 = line2
        else:
            self.site_line1 = line1
            self.site_line2 = line2

        if self._tty:
            width = self._term_width()
            if self._active:
                self.stream.write("\033[4F")
                for _ in range(4):
                    self.stream.write("\033[2K")
                    self.stream.write("\033[1B")
                self.stream.write("\033[4F")
            for line in (self.overall_line1, self.overall_line2, self.site_line1, self.site_line2):
                self.stream.write(self._truncate(line, width) + "\n")
            self.stream.flush()
            self._active = True
        else:
            # Non-TTY stderr cannot overwrite. Keep lines compact.
            print(line1, file=self.stream)
            print(line2, file=self.stream)

    def finish(self) -> None:
        if self._active and self._tty:
            self.stream.write("\n")
            self.stream.flush()
        self._active = False


class Reporter:
    def __init__(self, quiet: bool = False, verbose: bool = False, progress_every: float = 5.0, stream=None, dual_progress: Optional[DualProgress] = None, role: str = "site"):
        self.quiet = quiet
        self.verbose = verbose
        self.progress_every = progress_every
        self.stream = stream if stream is not None else sys.stdout
        self.dual_progress = dual_progress
        self.role = role
        self._last = 0.0
        self._live_active = False
        self._tty = self.stream.isatty() and not quiet and dual_progress is None

    def _term_width(self) -> int:
        return shutil.get_terminal_size((120, 24)).columns

    def _truncate(self, value: str, width: int) -> str:
        value = value or ""
        if len(value) <= width:
            return value
        if width <= 1:
            return value[:width]
        return value[: max(0, width - 1)] + "…"

    def _clear_live(self) -> None:
        if self._live_active and self._tty:
            self.stream.write("\033[2F")
            self.stream.write("\033[2K")
            self.stream.write("\033[1B")
            self.stream.write("\033[2K")
            self.stream.write("\033[1F")
            self.stream.flush()
            self._live_active = False

    def finish_progress(self) -> None:
        if self.dual_progress is not None:
            return
        if self._live_active and self._tty:
            self.stream.write("\n")
            self.stream.flush()
            self._live_active = False

    def header(self, domain: str, args: argparse.Namespace) -> None:
        if self.quiet:
            return
        print(f"\ncrawlfit v{VERSION}\n", file=self.stream)
        rows = [
            ("Target", domain),
            ("Discovery limit", f"{args.max_pages if args.max_pages is not None else 'adaptive'} URLs"),
            ("Sample size", f"{args.max_samples if args.max_samples is not None else 'adaptive'} pages"),
            ("Render sample", f"{args.render_pages if (args.render_check and args.render_pages is not None) else ('adaptive' if args.render_check else 0)} pages"),
            ("Render check", "enabled" if args.render_check else "disabled"),
            ("Mixed discovery", "enabled" if getattr(args, "mixed_discovery", True) else "disabled"),
            ("Sampler", "stratified"),
        ]
        width = max(len(k) for k, _ in rows)
        for k, v in rows:
            print(f"{k:<{width}}  {v}", file=self.stream)
        print("", file=self.stream)

    def stage(self, n: int, total: int, title: str) -> None:
        self.finish_progress()
        if self.dual_progress is not None:
            return
        if not self.quiet:
            print(f"\n[{n}/{total}] {title}", file=self.stream)

    def info(self, msg: str) -> None:
        self.finish_progress()
        if self.dual_progress is not None:
            return
        if not self.quiet:
            print(msg, file=self.stream)

    def detail(self, msg: str) -> None:
        if self.verbose and not self.quiet:
            self.finish_progress()
            print(msg, file=self.stream)

    def progress(
        self,
        done: int,
        total: int,
        start: float,
        label: str,
        force: bool = False,
        metrics: Optional[dict] = None,
        latest_url: Optional[str] = None,
    ) -> None:
        if self.quiet or total <= 0:
            return

        now = time.time()
        if not force and now - self._last < self.progress_every and done < total:
            return
        self._last = now

        elapsed = max(0.001, now - start)
        rate = done / elapsed
        remaining = max(0, total - done)
        eta = remaining / rate if rate > 0 else 0
        width = 28
        filled = int(width * min(done, total) / total)
        bar = "█" * filled + "─" * (width - filled)

        metric_text = ""
        if metrics:
            metric_text = " | " + " | ".join(f"{k}: {v}" for k, v in metrics.items())

        line1 = (
            f"{label} [{bar}] {done}/{total} | elapsed {fmt_duration(elapsed)} "
            f"| rate {rate*60:.1f}/min | ETA {fmt_duration(eta)}{metric_text}"
        )

        if self.role == "overall":
            line2 = f"Current: {latest_url or '-'}"
        else:
            line2 = f"Newest URL: {latest_url or '-'}"

        if self.dual_progress is not None:
            self.dual_progress.update(self.role, line1, line2)
            return

        if self._tty:
            term_width = self._term_width()
            if self._live_active:
                self.stream.write("\033[2F")
                self.stream.write("\033[2K")
                self.stream.write("\033[1B")
                self.stream.write("\033[2K")
                self.stream.write("\033[1F")
            self.stream.write(self._truncate(line1, term_width) + "\n")
            self.stream.write(self._truncate(line2, term_width) + "\n")
            self.stream.flush()
            self._live_active = True
        else:
            # Non-TTY output cannot safely overwrite. Keep it compact and one-line.
            print(line1, file=self.stream)
            if latest_url:
                print(line2, file=self.stream)

    def done(self, msg: str) -> None:
        self.finish_progress()
        if self.dual_progress is not None:
            return
        if not self.quiet:
            print(f"✓ {msg}", file=self.stream)

    def warn(self, msg: str) -> None:
        self.finish_progress()
        if self.dual_progress is not None:
            return
        if not self.quiet:
            print(f"! {msg}", file=self.stream)


@dataclasses.dataclass
class RawSignals:
    url: str
    status: Optional[int] = None
    content_type: str = ""
    final_url: str = ""
    depth: int = 0
    error: Optional[str] = None
    html_bytes: int = 0
    text_chars: int = 0
    text_sample: str = ""
    title: str = ""
    links_internal: int = 0
    images: int = 0
    scripts: int = 0
    script_srcs: int = 0
    noscript_chars: int = 0
    forms: int = 0
    iframes: int = 0
    lazy_images: int = 0
    structured_data: int = 0
    canonical: bool = False
    meta_noindex: bool = False
    js_framework_signal: bool = False
    client_app_signal: bool = False
    api_signal: bool = False
    bot_block_signal: bool = False
    pagination_signal: bool = False


@dataclasses.dataclass
class RenderSignals:
    attempted: bool = False
    ok: bool = False
    error: Optional[str] = None
    final_url: str = ""
    status: Optional[int] = None
    dom_bytes: int = 0
    text_chars: int = 0
    text_sample: str = ""
    title: str = ""
    links_internal: int = 0
    images: int = 0
    forms: int = 0
    iframes: int = 0
    network_requests: int = 0
    api_requests: int = 0
    xhr_fetch_requests: int = 0
    console_errors: int = 0
    scroll_text_gain: int = 0
    scroll_link_gain: int = 0
    bot_block_signal: bool = False


@dataclasses.dataclass
class Comparison:
    rendered_available: bool = False
    text_ratio_rendered_to_raw: Optional[float] = None
    text_gain_chars: int = 0
    text_similarity: Optional[float] = None
    link_gain: int = 0
    image_gain: int = 0
    dom_growth_ratio: Optional[float] = None
    title_changed: bool = False
    meaningful_render_delta: bool = False
    evidence: list[str] = dataclasses.field(default_factory=list)


@dataclasses.dataclass
class PageResult:
    url: str
    raw: RawSignals
    render: RenderSignals = dataclasses.field(default_factory=RenderSignals)
    comparison: Comparison = dataclasses.field(default_factory=Comparison)
    browsertrix_score: int = 0
    heritrix_score: int = 0
    recommendation: str = "unknown"
    reasons: list[str] = dataclasses.field(default_factory=list)


def fmt_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def normalize_start(value: str) -> str:
    if not re.match(r"^https?://", value, re.I):
        value = "https://" + value
    parsed = urllib.parse.urlparse(value)
    if not parsed.hostname:
        raise ValueError("Invalid domain or URL.")
    path = parsed.path or "/"
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc.lower(), path, "", "", ""))


def same_scope(url: str, root_host: str, include_subdomains: bool) -> bool:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    root_host = root_host.lower()
    return host == root_host or (include_subdomains and host.endswith("." + root_host))


def clean_url(href: str, base: str) -> Optional[str]:
    if not href:
        return None
    href = href.strip()
    if href.startswith(("mailto:", "tel:", "javascript:", "#")):
        return None
    url = urllib.parse.urljoin(base, href)
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return None
    if ASSET_RE.search(parsed.path):
        return None
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc.lower(), parsed.path or "/", "", parsed.query, ""))


def url_depth(url: str) -> int:
    parsed = urllib.parse.urlparse(url)
    return len([p for p in parsed.path.split("/") if p])


def normalized_text(text: str) -> str:
    return BOILERPLATE_WS_RE.sub(" ", text or "").strip()


def safe_ratio(a: float, b: float) -> Optional[float]:
    if b <= 0:
        return None
    return round(a / b, 3)


def fetch(session: requests.Session, url: str, timeout: float) -> requests.Response:
    return session.get(url, timeout=timeout, allow_redirects=True, headers={"User-Agent": UA})


def get_robots_sitemaps(start_url: str, session: requests.Session, timeout: float, reporter: Reporter) -> list[str]:
    parsed = urllib.parse.urlparse(start_url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    sitemaps = []
    try:
        r = fetch(session, robots_url, timeout)
        if r.status_code < 400:
            reporter.done("robots.txt found")
            for line in r.text.splitlines():
                if line.lower().startswith("sitemap:"):
                    sitemaps.append(line.split(":", 1)[1].strip())
        else:
            reporter.warn(f"robots.txt returned HTTP {r.status_code}")
    except requests.RequestException:
        reporter.warn("robots.txt unavailable")
    default = f"{parsed.scheme}://{parsed.netloc}/sitemap.xml"
    if default not in sitemaps:
        sitemaps.append(default)
    return sitemaps


def parse_sitemap_xml(xml_text: str) -> tuple[list[str], list[str]]:
    urls, indexes = [], []
    try:
        root = ET.fromstring(xml_text.encode("utf-8"))
    except ET.ParseError:
        return urls, indexes

    def strip_ns(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    if strip_ns(root.tag) == "urlset":
        for loc in root.iter():
            if strip_ns(loc.tag) == "loc" and loc.text:
                urls.append(loc.text.strip())
    elif strip_ns(root.tag) == "sitemapindex":
        for loc in root.iter():
            if strip_ns(loc.tag) == "loc" and loc.text:
                indexes.append(loc.text.strip())
    return urls, indexes


def discover_from_sitemaps(start_url: str, session: requests.Session, timeout: float, max_sitemaps: int, include_subdomains: bool, reporter: Reporter) -> tuple[list[str], dict]:
    root_host = urllib.parse.urlparse(start_url).hostname or ""
    queue = collections.deque(get_robots_sitemaps(start_url, session, timeout, reporter))
    seen_sitemaps, found = set(), []
    sitemap_indexes = 0
    sitemap_files = 0
    start = time.time()

    while queue and len(seen_sitemaps) < max_sitemaps:
        sm = queue.popleft()
        if sm in seen_sitemaps:
            continue
        seen_sitemaps.add(sm)
        try:
            r = fetch(session, sm, timeout)
            if r.status_code >= 400:
                continue
            urls, indexes = parse_sitemap_xml(r.text)
        except requests.RequestException:
            continue
        if indexes:
            sitemap_indexes += 1
        if urls:
            sitemap_files += 1
        for idx in indexes:
            if idx not in seen_sitemaps:
                queue.append(idx)
        for u in urls:
            cu = clean_url(u, start_url)
            if cu and same_scope(cu, root_host, include_subdomains):
                found.append(cu)
        reporter.progress(len(seen_sitemaps), max_sitemaps, start, "Sitemaps", metrics={"URLs": len(found)}, latest_url=(found[-1] if found else sm))

    meta = {"sitemap_indexes": sitemap_indexes, "sitemap_files": sitemap_files, "sitemaps_checked": len(seen_sitemaps)}
    return list(dict.fromkeys(found)), meta


def first_path_section(url: str) -> str:
    path = urllib.parse.urlparse(url).path.strip("/")
    if not path:
        return "/"
    return "/" + path.split("/", 1)[0] + "/"


def looks_paginated(url: str) -> bool:
    return bool(PAGINATION_RE.search(url))


def stable_url_sort(urls: list[str]) -> list[str]:
    return sorted(urls, key=lambda u: (url_depth(u), len(urllib.parse.urlparse(u).path), u))


def stratified_sample(urls: list[str], max_samples: int, seed: int = 13) -> tuple[list[str], dict]:
    urls = list(dict.fromkeys(urls))
    if max_samples <= 0:
        return [], {}
    if len(urls) <= max_samples:
        sample = stable_url_sort(urls)
        return sample, sample_stats(urls, sample)

    rng = random.Random(seed)
    selected: list[str] = []
    selected_set: set[str] = set()

    def add(candidates: list[str], n: int) -> None:
        nonlocal selected, selected_set
        if n <= 0:
            return
        for u in candidates:
            if len(selected) >= max_samples:
                return
            if u not in selected_set:
                selected.append(u)
                selected_set.add(u)
                n -= 1
                if n <= 0:
                    return

    sorted_urls = stable_url_sort(urls)
    add([u for u in sorted_urls if url_depth(u) == 0], 1)

    by_section: dict[str, list[str]] = collections.defaultdict(list)
    for u in sorted_urls:
        by_section[first_path_section(u)].append(u)

    sections = sorted(by_section.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    section_budget = max(1, int(max_samples * 0.35))
    for _, bucket in sections:
        if len(selected) >= section_budget:
            break
        add(stable_url_sort(bucket), 1)

    remaining_section_budget = max(0, int(max_samples * 0.25))
    total_urls = len(urls)
    max_per_section = max(2, math.ceil(max_samples * 0.12))
    for _, bucket in sections:
        quota = min(max_per_section, max(1, round(len(bucket) / total_urls * remaining_section_budget)))
        shallow = stable_url_sort(bucket)
        deep = sorted(bucket, key=lambda u: (url_depth(u), len(u)), reverse=True)
        mixed = []
        for pair in zip(shallow, deep):
            mixed.extend(pair)
        mixed.extend(shallow)
        add(mixed, quota)

    by_depth: dict[int, list[str]] = collections.defaultdict(list)
    for u in sorted_urls:
        by_depth[min(url_depth(u), 6)].append(u)

    depth_budget = max(1, int(max_samples * 0.15))
    per_depth = max(1, math.ceil(depth_budget / max(1, len(by_depth))))
    for depth in sorted(by_depth):
        add(stable_url_sort(by_depth[depth]), per_depth)

    add(stable_url_sort([u for u in urls if looks_paginated(u)]), max(1, int(max_samples * 0.08)))
    add(sorted(urls, key=lambda u: (url_depth(u), len(u), u), reverse=True), max(1, int(max_samples * 0.08)))

    remainder = [u for u in urls if u not in selected_set]
    rng.shuffle(remainder)
    add(remainder, max_samples - len(selected))

    sample = selected[:max_samples]
    return sample, sample_stats(urls, sample)


def sample_stats(discovered: list[str], sampled: list[str]) -> dict:
    by_section_all = collections.Counter(first_path_section(u) for u in discovered)
    by_section_sample = collections.Counter(first_path_section(u) for u in sampled)
    by_depth_sample = collections.Counter(min(url_depth(u), 6) for u in sampled)
    top_sections = []
    for section, count in by_section_all.most_common(20):
        top_sections.append({"section": section, "discovered": count, "sampled": by_section_sample.get(section, 0)})
    return {
        "sections": top_sections,
        "depth_distribution": {str(k): v for k, v in sorted(by_depth_sample.items())},
        "paginated_sampled": sum(1 for u in sampled if looks_paginated(u)),
        "deepest_sampled": max([url_depth(u) for u in sampled], default=0),
    }


def crawl_discover(start_url: str, session: requests.Session, timeout: float, max_discovery_pages: int, max_depth: int, include_subdomains: bool, reporter: Reporter) -> list[str]:
    root_host = urllib.parse.urlparse(start_url).hostname or ""
    queue = collections.deque([start_url])
    seen = set()
    discovered = []
    start = time.time()

    while queue and len(discovered) < max_discovery_pages:
        url = queue.popleft()
        if url in seen:
            continue
        seen.add(url)
        depth = url_depth(url)
        if depth > max_depth:
            continue
        discovered.append(url)
        try:
            r = fetch(session, url, timeout)
            if r.status_code >= 400 or not HTML_CT_RE.search(r.headers.get("content-type", "")):
                continue
            soup = BeautifulSoup(r.text[:1_500_000], "lxml")
            links = []
            for a in soup.find_all("a", href=True):
                cu = clean_url(a.get("href", ""), r.url)
                if cu and same_scope(cu, root_host, include_subdomains):
                    links.append(cu)
            for link in sorted(set(links), key=lambda u: (url_depth(u), len(u), u))[:100]:
                if link not in seen:
                    queue.append(link)
        except requests.RequestException:
            continue
        reporter.progress(len(discovered), max_discovery_pages, start, "Crawl discovery", metrics={"queue": len(queue), "discovered": len(seen)}, latest_url=url)

    return list(dict.fromkeys(discovered))[:max_discovery_pages]



def rendered_link_discover(
    seed_urls: list[str],
    timeout_ms: int,
    root_host: str,
    include_subdomains: bool,
    max_seed_pages: int,
    links_per_page: int,
    scroll: bool,
    reporter: Reporter,
) -> list[str]:
    """
    High-fidelity URL discovery using Chromium-rendered pages.

    This is not used for final fidelity scoring. It only enriches the candidate
    URL pool when sitemap/static discovery is too small or too shallow.
    """
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
    except Exception as e:
        reporter.warn(f"Rendered discovery unavailable: {e}")
        return []

    seeds = stable_url_sort(list(dict.fromkeys(seed_urls)))[:max_seed_pages]
    found: list[str] = []
    start = time.time()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=UA, java_script_enabled=True)
        page = context.new_page()

        for i, seed in enumerate(seeds, start=1):
            try:
                try:
                    page.goto(seed, wait_until="networkidle", timeout=timeout_ms)
                except PlaywrightTimeoutError:
                    page.goto(seed, wait_until="domcontentloaded", timeout=timeout_ms)

                page.wait_for_timeout(750)

                if scroll:
                    page.evaluate("""async () => {
                        await new Promise(resolve => {
                          let y = 0;
                          const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
                          const timer = setInterval(() => {
                            y += step;
                            window.scrollTo(0, y);
                            if (y >= document.body.scrollHeight - window.innerHeight) {
                              clearInterval(timer);
                              resolve();
                            }
                          }, 200);
                        });
                    }""")
                    page.wait_for_timeout(750)

                hrefs = page.eval_on_selector_all("a[href]", "els => els.map(a => a.href)")
                cleaned = []
                for href in hrefs:
                    cu = clean_url(href, page.url)
                    if cu and same_scope(cu, root_host, include_subdomains):
                        cleaned.append(cu)

                # Mix shallow and deep rendered links from each page.
                cleaned = list(dict.fromkeys(cleaned))
                mixed = stable_url_sort(cleaned)[: links_per_page // 2]
                mixed += sorted(cleaned, key=lambda u: (url_depth(u), len(u)), reverse=True)[: links_per_page - len(mixed)]
                found.extend(mixed)

                reporter.detail(f"  rendered discovery {seed}: {len(cleaned)} scoped links")
            except Exception as e:
                reporter.detail(f"  rendered discovery failed {seed}: {type(e).__name__}: {str(e)[:160]}")
            reporter.progress(i, len(seeds), start, "Rendered discovery", metrics={"links": len(set(found))}, latest_url=(found[-1] if found else seed))

        context.close()
        browser.close()

    reporter.progress(len(seeds), len(seeds), start, "Rendered discovery", force=True, metrics={"links": len(set(found))}, latest_url=(found[-1] if found else (seeds[-1] if seeds else None)))
    return list(dict.fromkeys(found))

def extract_raw_signals(url: str, response: requests.Response) -> RawSignals:
    html_text = response.text or ""
    soup = BeautifulSoup(html_text[:2_000_000], "lxml")
    body_text = normalized_text(soup.get_text(" ", strip=True))
    scripts = soup.find_all("script")
    noscript_text = normalized_text(" ".join(n.get_text(" ", strip=True) for n in soup.find_all("noscript")))
    links = [a.get("href") for a in soup.find_all("a", href=True)]
    parsed_final = urllib.parse.urlparse(response.url)
    internal = [clean_url(h or "", response.url) for h in links]
    internal = [u for u in internal if u and urllib.parse.urlparse(u).hostname == parsed_final.hostname]
    lazy_images = len(soup.select("img[loading='lazy'], img[data-src], source[data-srcset]"))
    structured = len(soup.find_all("script", type=re.compile("ld\\+json", re.I)))
    meta_robots = " ".join(m.get("content", "") for m in soup.find_all("meta", attrs={"name": re.compile("robots", re.I)}))
    canonical = soup.find("link", rel=lambda x: x and "canonical" in x) is not None
    title = normalized_text(soup.title.get_text(" ", strip=True)) if soup.title else ""

    return RawSignals(
        url=url,
        status=response.status_code,
        content_type=response.headers.get("content-type", ""),
        final_url=response.url,
        depth=url_depth(response.url),
        html_bytes=len(response.content or b""),
        text_chars=len(body_text),
        text_sample=body_text[:500],
        title=title,
        links_internal=len(set(internal)),
        images=len(soup.find_all("img")),
        scripts=len(scripts),
        script_srcs=len([s.get("src") for s in scripts if s.get("src")]),
        noscript_chars=len(noscript_text),
        forms=len(soup.find_all("form")),
        iframes=len(soup.find_all("iframe")),
        lazy_images=lazy_images,
        structured_data=structured,
        canonical=canonical,
        meta_noindex="noindex" in meta_robots.lower(),
        js_framework_signal=bool(JS_FRAMEWORK_RE.search(html_text[:2_000_000])),
        client_app_signal=bool(CLIENT_APP_RE.search(html_text[:2_000_000])),
        api_signal=bool(API_HINT_RE.search(html_text[:2_000_000])),
        bot_block_signal=bool(BOT_BLOCK_RE.search(html_text[:200_000])),
        pagination_signal=bool(PAGINATION_RE.search(response.url + " " + html_text[:100_000])),
    )


def fetch_raw(url: str, timeout: float) -> RawSignals:
    session = requests.Session()
    session.headers.update({"User-Agent": UA})
    try:
        r = fetch(session, url, timeout)
        if not HTML_CT_RE.search(r.headers.get("content-type", "")):
            return RawSignals(url=url, status=r.status_code, content_type=r.headers.get("content-type", ""), final_url=r.url, depth=url_depth(r.url), error="non-HTML content")
        return extract_raw_signals(url, r)
    except requests.RequestException as e:
        return RawSignals(url=url, error=type(e).__name__)


def render_one_sync(url: str, timeout_ms: int, scroll: bool, root_host: str, include_subdomains: bool) -> RenderSignals:
    rs = RenderSignals(attempted=True)
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
    except Exception as e:
        rs.error = f"Playwright unavailable: {e}"
        return rs

    network_requests = api_requests = xhr_fetch_requests = console_errors = 0
    status_holder = {"status": None}

    def is_api_like(req_url: str) -> bool:
        return bool(re.search(r"(/api/|graphql|\.json(\?|$)|format=json)", req_url, re.I))

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(user_agent=UA, java_script_enabled=True)
            page = context.new_page()

            def on_request(request):
                nonlocal network_requests, api_requests, xhr_fetch_requests
                network_requests += 1
                if is_api_like(request.url):
                    api_requests += 1
                if request.resource_type in ("xhr", "fetch"):
                    xhr_fetch_requests += 1

            def on_console(msg):
                nonlocal console_errors
                if msg.type == "error":
                    console_errors += 1

            page.on("request", on_request)
            page.on("console", on_console)

            try:
                resp = page.goto(url, wait_until="networkidle", timeout=timeout_ms)
            except PlaywrightTimeoutError:
                resp = page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)

            if resp:
                status_holder["status"] = resp.status

            page.wait_for_timeout(750)
            before_text = normalized_text(page.locator("body").inner_text(timeout=timeout_ms // 2))
            before_links = page.eval_on_selector_all("a[href]", "els => els.map(a => a.href)")
            before_internal = {u for u in before_links if same_scope(u, root_host, include_subdomains) and not ASSET_RE.search(urllib.parse.urlparse(u).path)}

            if scroll:
                page.evaluate("""async () => {
                    await new Promise(resolve => {
                      let y = 0;
                      const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
                      const timer = setInterval(() => {
                        y += step;
                        window.scrollTo(0, y);
                        if (y >= document.body.scrollHeight - window.innerHeight) {
                          clearInterval(timer);
                          resolve();
                        }
                      }, 250);
                    });
                }""")
                page.wait_for_timeout(1000)

            after_text = normalized_text(page.locator("body").inner_text(timeout=timeout_ms // 2))
            links = page.eval_on_selector_all("a[href]", "els => els.map(a => a.href)")
            internal = {u for u in links if same_scope(u, root_host, include_subdomains) and not ASSET_RE.search(urllib.parse.urlparse(u).path)}
            title = normalized_text(page.title())
            html_text = page.content()

            rs.ok = True
            rs.status = status_holder["status"]
            rs.final_url = page.url
            rs.dom_bytes = len(html_text.encode("utf-8", errors="ignore"))
            rs.text_chars = len(after_text)
            rs.text_sample = after_text[:500]
            rs.title = title
            rs.links_internal = len(internal)
            rs.images = int(page.eval_on_selector_all("img", "els => els.length"))
            rs.forms = int(page.eval_on_selector_all("form", "els => els.length"))
            rs.iframes = int(page.eval_on_selector_all("iframe", "els => els.length"))
            rs.network_requests = network_requests
            rs.api_requests = api_requests
            rs.xhr_fetch_requests = xhr_fetch_requests
            rs.console_errors = console_errors
            rs.scroll_text_gain = max(0, len(after_text) - len(before_text))
            rs.scroll_link_gain = max(0, len(internal) - len(before_internal))
            rs.bot_block_signal = bool(BOT_BLOCK_RE.search((title + " " + after_text)[:200_000]))
            context.close()
            browser.close()
    except Exception as e:
        rs.error = type(e).__name__ + ": " + str(e)[:300]
    return rs


def compare_raw_render(raw: RawSignals, render: RenderSignals) -> Comparison:
    c = Comparison(rendered_available=render.ok)
    if not render.ok:
        if render.error:
            c.evidence.append(render.error)
        return c

    c.text_gain_chars = max(0, render.text_chars - raw.text_chars)
    c.text_ratio_rendered_to_raw = safe_ratio(render.text_chars, max(raw.text_chars, 1))
    c.link_gain = max(0, render.links_internal - raw.links_internal)
    c.image_gain = max(0, render.images - raw.images)
    c.dom_growth_ratio = safe_ratio(render.dom_bytes, max(raw.html_bytes, 1))
    c.title_changed = bool(raw.title and render.title and raw.title != render.title)
    if raw.text_sample or render.text_sample:
        c.text_similarity = round(difflib.SequenceMatcher(None, raw.text_sample, render.text_sample).ratio(), 3)

    evidence = []
    if c.text_ratio_rendered_to_raw is not None and c.text_ratio_rendered_to_raw >= 1.8 and c.text_gain_chars >= 1000:
        evidence.append(f"rendered text is {c.text_ratio_rendered_to_raw}x raw HTML text (+{c.text_gain_chars} chars)")
    if c.link_gain >= 10:
        evidence.append(f"rendering exposed {c.link_gain} additional internal links")
    if c.image_gain >= 5:
        evidence.append(f"rendering exposed {c.image_gain} additional images")
    if c.dom_growth_ratio is not None and c.dom_growth_ratio >= 1.8:
        evidence.append(f"rendered DOM is {c.dom_growth_ratio}x raw HTML size")
    if render.xhr_fetch_requests >= 3:
        evidence.append(f"{render.xhr_fetch_requests} XHR/fetch requests observed")
    if render.api_requests >= 2:
        evidence.append(f"{render.api_requests} API-like requests observed")
    if render.scroll_text_gain >= 800:
        evidence.append(f"scrolling revealed +{render.scroll_text_gain} text chars")
    if render.scroll_link_gain >= 5:
        evidence.append(f"scrolling revealed +{render.scroll_link_gain} internal links")
    if render.bot_block_signal:
        evidence.append("rendered page showed bot-block/CAPTCHA/challenge text")
    if c.title_changed:
        evidence.append("title changed after rendering")

    c.evidence = evidence[:10]
    c.meaningful_render_delta = bool(evidence)
    return c


def score_page(raw: RawSignals, render: RenderSignals, comparison: Comparison) -> tuple[int, int, str, list[str]]:
    b, h, reasons = 0, 0, []
    if raw.error:
        return 0, 0, "review", [raw.error]
    if raw.status and raw.status >= 400:
        return 0, 0, "review", [f"HTTP {raw.status}"]

    if raw.bot_block_signal:
        b += 4; reasons.append("raw HTML has bot-block/CAPTCHA/JS challenge text")
    if raw.client_app_signal:
        b += 4; reasons.append("client-side app shell or hydration marker")
    if raw.js_framework_signal:
        b += 3; reasons.append("JS framework/hydration signal")
    if raw.api_signal:
        b += 2; reasons.append("API/fetch/graphql signal in raw HTML")
    if raw.text_chars < 800 and raw.scripts >= 8:
        b += 3; reasons.append("low raw text with many scripts")
    if raw.forms:
        b += 2; reasons.append("forms may need rendered state")
    if raw.iframes:
        b += 2; reasons.append("iframes may affect high-fidelity capture")
    if raw.lazy_images >= 3:
        b += 1; reasons.append("lazy-loaded media hints")

    if raw.pagination_signal:
        h += 1; reasons.append("crawlable pagination/listing signal")
    if raw.links_internal >= 20:
        h += 2; reasons.append("many static internal links")
    if raw.text_chars >= 1500:
        h += 2; reasons.append("substantial raw HTML text")
    if raw.structured_data:
        h += 1; reasons.append("structured data in raw HTML")
    if raw.canonical:
        h += 1; reasons.append("canonical URL present")

    if render.attempted and not render.ok:
        reasons.append("render comparison unavailable: " + (render.error or "unknown error"))

    if comparison.rendered_available:
        if comparison.text_ratio_rendered_to_raw is not None and comparison.text_ratio_rendered_to_raw >= 1.8 and comparison.text_gain_chars >= 1000:
            b += 5
        elif comparison.text_gain_chars >= 500:
            b += 2
        if comparison.link_gain >= 25:
            b += 5
        elif comparison.link_gain >= 10:
            b += 3
        elif comparison.link_gain >= 3:
            b += 1
        if comparison.image_gain >= 10:
            b += 3
        elif comparison.image_gain >= 5:
            b += 1
        if comparison.dom_growth_ratio is not None and comparison.dom_growth_ratio >= 2.5:
            b += 3
        elif comparison.dom_growth_ratio is not None and comparison.dom_growth_ratio >= 1.5:
            b += 1
        if render.xhr_fetch_requests >= 5:
            b += 3
        elif render.xhr_fetch_requests >= 2:
            b += 1
        if render.scroll_text_gain >= 800 or render.scroll_link_gain >= 5:
            b += 2
        if not comparison.meaningful_render_delta and raw.text_chars >= 1500 and raw.links_internal >= 10:
            h += 4; reasons.append("rendered comparison found no meaningful content/link delta")
        reasons.extend(comparison.evidence)

    if raw.meta_noindex:
        reasons.append("meta noindex present; consider excluding or lowering priority")

    if b >= 8 and b >= h + 2:
        rec = "browsertrix"
    elif h >= 6 and b <= 4:
        rec = "heritrix"
    elif b >= 5:
        rec = "hybrid/browsertrix-for-this-page"
    else:
        rec = "heritrix"
    return b, h, rec, reasons[:12]


def analyze_static_url(url: str, timeout: float) -> PageResult:
    raw = fetch_raw(url, timeout)
    comparison = Comparison(rendered_available=False)
    render = RenderSignals(attempted=False)
    b, h, rec, reasons = score_page(raw, render, comparison)
    return PageResult(url=url, raw=raw, render=render, comparison=comparison, browsertrix_score=b, heritrix_score=h, recommendation=rec, reasons=reasons)


def choose_render_subset(static_results: list[PageResult], render_pages: int) -> tuple[list[PageResult], dict]:
    ranked = sorted(static_results, key=lambda r: (r.browsertrix_score, r.raw.scripts, -r.raw.text_chars, r.raw.depth), reverse=True)
    controls = sorted(static_results, key=lambda r: (r.heritrix_score, r.raw.links_internal, r.raw.text_chars), reverse=True)
    selected, seen = [], set()
    reason_counts = collections.Counter()

    for r in ranked:
        if r.url in seen:
            continue
        selected.append(r); seen.add(r.url)
        if r.raw.client_app_signal: reason_counts["app shells"] += 1
        if r.raw.js_framework_signal: reason_counts["JS frameworks"] += 1
        if r.raw.api_signal: reason_counts["API hints"] += 1
        if r.raw.forms: reason_counts["forms"] += 1
        if r.raw.text_chars < 800 and r.raw.scripts >= 8: reason_counts["low text / many scripts"] += 1
        if len(selected) >= max(1, int(render_pages * 0.75)):
            break

    for r in controls:
        if r.url not in seen:
            selected.append(r); seen.add(r.url)
            reason_counts["Heritrix-looking controls"] += 1
        if len(selected) >= render_pages:
            break
    return selected[:render_pages], dict(reason_counts)


def add_render_results(static_results: list[PageResult], render_targets: list[PageResult], timeout_ms: int, scroll: bool, root_host: str, include_subdomains: bool, reporter: Reporter) -> list[PageResult]:
    by_url = {r.url: r for r in static_results}
    start = time.time()
    done = 0
    for target in render_targets:
        if reporter.verbose and not reporter.quiet:
            print(f"\nRendering [{done+1}/{len(render_targets)}] {target.url}")
        render = render_one_sync(target.url, timeout_ms, scroll, root_host, include_subdomains)
        comparison = compare_raw_render(target.raw, render)
        b, h, rec, reasons = score_page(target.raw, render, comparison)
        by_url[target.url] = PageResult(target.url, target.raw, render, comparison, b, h, rec, reasons)
        done += 1

        rendered_so_far = [r for r in by_url.values() if r.render.attempted]
        ok = sum(1 for r in rendered_so_far if r.render.ok)
        deltas = sum(1 for r in rendered_so_far if r.comparison.meaningful_render_delta)
        api = sum(1 for r in rendered_so_far if r.render.api_requests or r.render.xhr_fetch_requests)
        metrics = {
            "ok": ok,
            "major deltas": deltas,
            "API/XHR pages": api,
            "live": live_recommendation(list(by_url.values())),
        }
        reporter.progress(done, len(render_targets), start, "Render comparison", force=reporter.verbose, metrics=metrics, latest_url=target.url)
        if reporter.verbose:
            reporter.detail(f"  DOM +ratio: {comparison.dom_growth_ratio} | text +{comparison.text_gain_chars} | links +{comparison.link_gain} | rec {rec}")

    reporter.progress(done, len(render_targets), start, "Render comparison", force=True, latest_url=(render_targets[-1].url if render_targets else None))
    return [by_url[r.url] for r in static_results]


def domain_recommendation(results: list[PageResult]) -> tuple[str, dict]:
    valid = [r for r in results if not r.raw.error and r.raw.status and r.raw.status < 400]
    if not valid:
        return "insufficient-data", {}

    counts = collections.Counter(r.recommendation for r in valid)
    bt_scores = [r.browsertrix_score for r in valid]
    h_scores = [r.heritrix_score for r in valid]
    browserish = sum(1 for r in valid if r.recommendation.startswith("browsertrix") or "browsertrix" in r.recommendation)
    browser_ratio = browserish / len(valid)

    rendered = [r for r in valid if r.render.attempted]
    rendered_ok = [r for r in rendered if r.render.ok]
    rendered_delta = [r for r in rendered_ok if r.comparison.meaningful_render_delta]
    delta_ratio = len(rendered_delta) / len(rendered_ok) if rendered_ok else None

    if delta_ratio is not None:
        if delta_ratio >= 0.45:
            rec = "browsertrix"
        elif delta_ratio >= 0.18:
            rec = "hybrid"
        elif browser_ratio >= 0.30:
            rec = "hybrid"
        else:
            rec = "heritrix"
    else:
        if browser_ratio >= 0.45 or statistics.mean(bt_scores) >= statistics.mean(h_scores) + 1.5:
            rec = "browsertrix"
        elif browser_ratio >= 0.18:
            rec = "hybrid"
        else:
            rec = "heritrix"

    confidence = confidence_label(rec, browser_ratio, delta_ratio)

    return rec, {
        "valid_pages": len(valid),
        "counts": dict(counts),
        "browsertrix_ratio": round(browser_ratio, 3),
        "mean_browsertrix_score": round(statistics.mean(bt_scores), 2),
        "mean_heritrix_score": round(statistics.mean(h_scores), 2),
        "rendered_attempted": len(rendered),
        "rendered_ok": len(rendered_ok),
        "rendered_meaningful_delta": len(rendered_delta),
        "rendered_delta_ratio": None if delta_ratio is None else round(delta_ratio, 3),
        "confidence": confidence,
    }


def confidence_label(rec: str, browser_ratio: float, delta_ratio: Optional[float]) -> str:
    if delta_ratio is not None:
        if rec == "browsertrix" and delta_ratio >= 0.60:
            return "high"
        if rec == "heritrix" and delta_ratio <= 0.10 and browser_ratio <= 0.20:
            return "high"
        if rec == "hybrid" and 0.20 <= delta_ratio <= 0.70:
            return "high"
        return "moderate"
    if browser_ratio <= 0.12 or browser_ratio >= 0.55:
        return "moderate"
    return "low"


def live_recommendation(results: list[PageResult]) -> str:
    rec, metrics = domain_recommendation(results)
    conf = metrics.get("confidence", "unknown") if metrics else "unknown"
    return f"{rec} ({conf})"


def summarize_paths(results: list[PageResult]) -> list[dict]:
    buckets: dict[str, list[PageResult]] = collections.defaultdict(list)
    for r in results:
        p = urllib.parse.urlparse(r.raw.final_url or r.url).path
        key = "/" + (p.strip("/").split("/")[0] if p.strip("/") else "")
        buckets[key].append(r)

    out = []
    for path, rows in sorted(buckets.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        recs = collections.Counter(r.recommendation for r in rows)
        rendered = [r for r in rows if r.render.ok]
        deltas = [r for r in rendered if r.comparison.meaningful_render_delta]
        out.append({
            "path": path or "/",
            "pages": len(rows),
            "dominant_recommendation": recs.most_common(1)[0][0],
            "recommendations": dict(recs),
            "rendered_pages": len(rendered),
            "rendered_delta_pages": len(deltas),
        })
    return out[:25]


def static_progress_metrics(results: list[PageResult]) -> dict:
    counts = collections.Counter(r.recommendation for r in results)
    return {
        "Heritrix": counts.get("heritrix", 0),
        "Hybrid": sum(v for k, v in counts.items() if "hybrid" in k),
        "Browsertrix": counts.get("browsertrix", 0),
        "live": live_recommendation(results),
    }


def print_sample_distribution(stats: dict, reporter: Reporter) -> None:
    if reporter.quiet:
        return
    reporter.info("\nSection distribution")
    for row in stats.get("sections", [])[:12]:
        reporter.info(f"  {row['section']:<24} {row['discovered']:>6} URLs → {row['sampled']:>4} sampled")
    reporter.info("\nDepth distribution")
    for depth, count in stats.get("depth_distribution", {}).items():
        label = f"depth{depth}" if depth != "6" else "depth6+"
        reporter.info(f"  {label:<8} {count}")


def print_text_report(domain: str, discovered_count: int, sampled: list[str], results: list[PageResult]) -> None:
    rec, metrics = domain_recommendation(results)
    print(f"\nDomain: {domain}")
    print(f"Discovered pages: {discovered_count}")
    print(f"Sampled pages: {len(sampled)}")
    print("Sampler: stratified")
    print(f"Analyzed pages: {len(results)}")
    print(f"Recommendation: {rec.upper()}")
    if metrics:
        print(f"Confidence: {metrics.get('confidence', 'unknown')}\n")
        print("Metrics:")
        for k, v in metrics.items():
            print(f"  {k}: {v}")

    print("\nPath summary:")
    for row in summarize_paths(results):
        delta = ""
        if row["rendered_pages"]:
            delta = f" | render deltas {row['rendered_delta_pages']}/{row['rendered_pages']}"
        print(f"  {row['path']:<28} {row['pages']:>3} pages  -> {row['dominant_recommendation']}{delta}")

    print("\nStrongest Browsertrix evidence:")
    candidates = sorted(results, key=lambda r: (r.browsertrix_score, r.comparison.text_gain_chars, r.comparison.link_gain), reverse=True)[:12]
    for r in candidates:
        reason = "; ".join(r.reasons[:5]) or "no strong rendering signal"
        render_mark = "rendered" if r.render.ok else ("render-failed" if r.render.attempted else "static-only")
        print(f"  [{r.browsertrix_score:>2}B/{r.heritrix_score:>2}H] {r.recommendation:<32} {render_mark:<12} {r.url}")
        print(f"      {reason}")

    print("\nCrawl plan:")
    if rec == "heritrix":
        print("  Use Heritrix as the primary crawler. Browsertrix is optional for manually chosen high-value pages.")
    elif rec == "browsertrix":
        print("  Use Browsertrix as the primary crawler. Render comparison/static signals indicate non-rendered capture would lose fidelity.")
    elif rec == "hybrid":
        print("  Use Heritrix broadly for coverage, plus Browsertrix for paths/pages with render deltas or high Browsertrix scores.")
    else:
        print("  Not enough successful HTML pages were sampled.")


def result_payload(args: argparse.Namespace, start_url: str, discovered: list[str], sampled: list[str], sample_stats_data: dict, results: list[PageResult], discovery_meta: dict) -> dict:
    rec, metrics = domain_recommendation(results)
    return {
        "domain": args.domain,
        "start_url": start_url,
        "version": VERSION,
        "discovered_pages": len(discovered),
        "sampled_pages": len(sampled),
        "sampler": "stratified",
        "sample_stats": sample_stats_data,
        "discovery": discovery_meta,
        "fallback_cap_applied": bool(discovery_meta.get("sitemap_insufficient")),
        "fallback_cap": FALLBACK_DISCOVERY_CAP if discovery_meta.get("sitemap_insufficient") else None,
        "mixed_discovery": {
            "enabled": getattr(args, "mixed_discovery", True),
            "render_discovery_pages": getattr(args, "render_discovery_pages", None),
            "render_discovery_links_per_page": getattr(args, "render_discovery_links_per_page", None),
        },
        "domain_recommendation": rec,
        "metrics": metrics,
        "path_summary": summarize_paths(results),
        "pages": [dataclasses.asdict(r) for r in results],
    }


def write_reports(report_dir: str, payload: dict, reporter: Reporter) -> None:
    out = Path(report_dir)
    out.mkdir(parents=True, exist_ok=True)

    json_path = out / "crawlfit-report.json"
    csv_path = out / "crawlfit-pages.csv"
    html_path = out / "crawlfit-report.html"

    json_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    pages = payload["pages"]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "url", "recommendation", "browsertrix_score", "heritrix_score",
            "raw_status", "raw_text_chars", "raw_links_internal", "raw_scripts",
            "render_attempted", "render_ok", "render_text_chars", "render_links_internal",
            "text_gain_chars", "link_gain", "image_gain", "dom_growth_ratio", "reasons"
        ])
        writer.writeheader()
        for p in pages:
            writer.writerow({
                "url": p["url"],
                "recommendation": p["recommendation"],
                "browsertrix_score": p["browsertrix_score"],
                "heritrix_score": p["heritrix_score"],
                "raw_status": p["raw"]["status"],
                "raw_text_chars": p["raw"]["text_chars"],
                "raw_links_internal": p["raw"]["links_internal"],
                "raw_scripts": p["raw"]["scripts"],
                "render_attempted": p["render"]["attempted"],
                "render_ok": p["render"]["ok"],
                "render_text_chars": p["render"]["text_chars"],
                "render_links_internal": p["render"]["links_internal"],
                "text_gain_chars": p["comparison"]["text_gain_chars"],
                "link_gain": p["comparison"]["link_gain"],
                "image_gain": p["comparison"]["image_gain"],
                "dom_growth_ratio": p["comparison"]["dom_growth_ratio"],
                "reasons": " | ".join(p["reasons"]),
            })

    html_path.write_text(render_html_report(payload), encoding="utf-8")
    reporter.done(f"reports written to {out}")


def render_html_report(payload: dict) -> str:
    metrics = payload.get("metrics", {})
    rec = html.escape(str(payload.get("domain_recommendation", ""))).upper()
    rows = []
    for p in sorted(payload["pages"], key=lambda x: (x["browsertrix_score"], x["comparison"]["text_gain_chars"], x["comparison"]["link_gain"]), reverse=True):
        reasons = html.escape("; ".join(p["reasons"][:5]))
        rows.append(f"""
        <tr>
          <td><a href="{html.escape(p['url'])}">{html.escape(p['url'])}</a></td>
          <td>{html.escape(p['recommendation'])}</td>
          <td>{p['browsertrix_score']}</td>
          <td>{p['heritrix_score']}</td>
          <td>{p['raw']['text_chars']}</td>
          <td>{p['raw']['links_internal']}</td>
          <td>{p['render']['ok']}</td>
          <td>{p['comparison']['text_gain_chars']}</td>
          <td>{p['comparison']['link_gain']}</td>
          <td>{reasons}</td>
        </tr>""")

    path_rows = []
    for r in payload.get("path_summary", []):
        path_rows.append(f"<tr><td>{html.escape(r['path'])}</td><td>{r['pages']}</td><td>{html.escape(r['dominant_recommendation'])}</td><td>{r['rendered_delta_pages']}/{r['rendered_pages']}</td></tr>")

    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>crawlfit report</title>
<style>
body {{ font-family: system-ui, sans-serif; margin: 2rem; }}
table {{ border-collapse: collapse; width: 100%; font-size: 14px; }}
th, td {{ border: 1px solid #ddd; padding: 6px; vertical-align: top; }}
th {{ background: #f3f3f3; text-align: left; }}
code, pre {{ background: #f6f6f6; padding: 2px 4px; }}
.summary {{ display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 1rem; margin: 1rem 0; }}
.card {{ border: 1px solid #ddd; padding: 1rem; border-radius: 8px; }}
</style>
</head>
<body>
<h1>crawlfit report</h1>
<div class="summary">
  <div class="card"><b>Recommendation</b><br>{rec}</div>
  <div class="card"><b>Confidence</b><br>{html.escape(str(metrics.get('confidence', 'unknown')))}</div>
  <div class="card"><b>Discovered</b><br>{payload.get('discovered_pages')}</div>
  <div class="card"><b>Sampled</b><br>{payload.get('sampled_pages')}</div>
</div>

<h2>Metrics</h2>
<pre>{html.escape(json.dumps(metrics, indent=2))}</pre>

<h2>Path summary</h2>
<table>
<tr><th>Path</th><th>Pages</th><th>Dominant recommendation</th><th>Render deltas</th></tr>
{''.join(path_rows)}
</table>

<h2>Page findings</h2>
<table>
<tr>
<th>URL</th><th>Recommendation</th><th>B score</th><th>H score</th><th>Raw text</th><th>Raw links</th><th>Rendered?</th><th>Text gain</th><th>Link gain</th><th>Reasons</th>
</tr>
{''.join(rows)}
</table>
</body>
</html>"""



def adaptive_defaults(args: argparse.Namespace) -> argparse.Namespace:
    """
    Fill unset limits with adaptive defaults.

    Defaults:
      --render-check: enabled unless --no-render-check is passed
      --include-subdomains: enabled unless --no-include-subdomains is passed
      --max-pages: 10000
      --max-samples:
          <= 1000 discovered URLs      -> 60
          1001-10000 discovered URLs   -> 100
          10001-100000 discovered URLs -> 200
          >100000 discovered URLs      -> 300
      --render-pages: 20% of sample, capped at 50
      fallback cap: if sitemap coverage is insufficient, fallback discovery and final sample size are capped at 200
      --workers: min(32, os.cpu_count() * 2)
      --timeout: 15 seconds
      --progress-every: 2 seconds
    """
    if args.max_pages is None:
        args.max_pages = 10000
    if args.timeout is None:
        args.timeout = 15.0
    if args.workers is None:
        args.workers = min(32, max(1, (os.cpu_count() or 1) * 2))
    if args.progress_every is None:
        args.progress_every = 2.0
    return args


def adaptive_sample_size(discovered_count: int) -> int:
    if discovered_count <= 1000:
        return 60
    if discovered_count <= 10000:
        return 100
    if discovered_count <= 100000:
        return 200
    return 300


def adaptive_render_pages(sample_count: int) -> int:
    return max(1, min(50, math.ceil(sample_count * 0.20)))


FALLBACK_DISCOVERY_CAP = 200


def effective_sample_size(requested: Optional[int], discovered_count: int, sitemap_insufficient: bool) -> int:
    base = requested if requested is not None else adaptive_sample_size(discovered_count)
    if sitemap_insufficient:
        base = min(base, FALLBACK_DISCOVERY_CAP)
    return min(base, discovered_count)


def effective_render_discovery_pages(sample_count: int, configured: int) -> int:
    # Rendered discovery is only for fallback URL enrichment, so keep it proportional
    # to the fallback-capped sample and avoid overspending before analysis begins.
    return max(1, min(configured, max(8, math.ceil(sample_count * 0.10))))



def load_targets(target: str) -> tuple[bool, list[str]]:
    """
    Return (is_batch, domains). If target is an existing file, read one domain
    per line and ignore blank lines and comments beginning with #.
    Otherwise treat target as a single domain/URL.
    """
    p = Path(target)
    if p.is_file():
        domains = []
        for line in p.read_text(encoding="utf-8").splitlines():
            value = line.strip()
            if not value or value.startswith("#"):
                continue
            domains.append(value)
        return True, domains
    return False, [target]


def tsv_line(payload: dict) -> str:
    metrics = payload.get("metrics") or {}
    fields = [
        payload.get("domain", ""),
        payload.get("domain_recommendation", ""),
        metrics.get("confidence", ""),
    ]
    return "\t".join(str(x).replace("\t", " ").replace("\n", " ") for x in fields)


def print_tsv(payloads: list[dict], header: bool = False) -> None:
    if header:
        print("domain\tdomain_recommendation\tconfidence")
    for payload in payloads:
        print(tsv_line(payload))


def derive_report_dir(base_report_dir: Optional[str], domain: str, is_batch: bool) -> Optional[str]:
    if not base_report_dir:
        return None
    if not is_batch:
        return base_report_dir
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", domain.strip())[:120] or "domain"
    return str(Path(base_report_dir) / safe)


def print_payload_summary(payload: dict) -> None:
    metrics = payload.get("metrics") or {}
    print(f"\nDomain: {payload.get('domain')}")
    print(f"Discovered pages: {payload.get('discovered_pages', '')}")
    print(f"Sampled pages: {payload.get('sampled_pages', '')}")
    print(f"Sampler: {payload.get('sampler', '')}")
    print(f"Recommendation: {str(payload.get('domain_recommendation', '')).upper()}")
    print(f"Confidence: {metrics.get('confidence', 'unknown')}")
    if metrics:
        print("\nMetrics:")
        for k, v in metrics.items():
            print(f"  {k}: {v}")

    path_summary = payload.get("path_summary") or []
    if path_summary:
        print("\nPath summary:")
        for row in path_summary[:25]:
            delta = ""
            if row.get("rendered_pages"):
                delta = f" | render deltas {row.get('rendered_delta_pages')}/{row.get('rendered_pages')}"
            print(f"  {row.get('path', ''):<28} {row.get('pages', 0):>3} pages  -> {row.get('dominant_recommendation', '')}{delta}")

    pages = payload.get("pages") or []
    if pages:
        print("\nStrongest Browsertrix evidence:")
        top = sorted(
            pages,
            key=lambda p: (
                p.get("browsertrix_score", 0),
                (p.get("comparison") or {}).get("text_gain_chars", 0),
                (p.get("comparison") or {}).get("link_gain", 0),
            ),
            reverse=True,
        )[:12]
        for p in top:
            reasons = "; ".join((p.get("reasons") or [])[:5]) or "no strong rendering signal"
            render = p.get("render") or {}
            render_mark = "rendered" if render.get("ok") else ("render-failed" if render.get("attempted") else "static-only")
            print(f"  [{p.get('browsertrix_score', 0):>2}B/{p.get('heritrix_score', 0):>2}H] {p.get('recommendation', ''):<32} {render_mark:<12} {p.get('url')}")
            print(f"      {reasons}")


def analyze_domain(args: argparse.Namespace) -> dict:
    progress_stream = sys.stderr if getattr(args, "progress_to_stderr", True) else sys.stdout
    reporter = Reporter(quiet=args.quiet, verbose=args.verbose, progress_every=args.progress_every, stream=progress_stream, dual_progress=getattr(args, "dual_progress", None), role="site")

    try:
        start_url = normalize_start(args.domain)
    except ValueError as e:
        return {"domain": args.domain, "error": str(e), "domain_recommendation": "error", "metrics": {"confidence": "none"}}

    reporter.header(args.domain, args)
    session = requests.Session()
    session.headers.update({"User-Agent": UA})

    total_stages = 7 if args.report_dir else 6

    reporter.stage(1, total_stages, "Discovering URLs")
    sitemap_urls, discovery_meta = discover_from_sitemaps(start_url, session, args.timeout, args.max_sitemaps, args.include_subdomains, reporter)
    discovered = list(dict.fromkeys(sitemap_urls))[: args.max_pages]
    if discovered:
        reporter.done(f"{discovery_meta.get('sitemap_indexes', 0)} sitemap indexes")
        reporter.done(f"{discovery_meta.get('sitemap_files', 0)} sitemap files")
        reporter.done(f"{len(discovered)} URLs discovered from sitemaps")

    provisional_max_samples = args.max_samples if args.max_samples is not None else adaptive_sample_size(len(discovered))
    preliminary_sample, _ = stratified_sample(discovered, min(provisional_max_samples, len(discovered)), args.sample_seed)
    depths = {url_depth(u) for u in preliminary_sample}

    sitemap_insufficient = len(preliminary_sample) < min(15, provisional_max_samples) or len(depths) < 2
    discovery_meta["sitemap_insufficient"] = sitemap_insufficient

    if sitemap_insufficient:
        if args.mixed_discovery:
            reporter.warn("No sufficiently broad sitemap sample found. Enriching with mixed static + rendered discovery...")
        else:
            reporter.warn("No sufficiently broad sitemap sample found. Switching to static bounded crawl...")
        reporter.warn("Fallback discovery active: final sample size will be capped at 200 pages.")

        fallback_discovery_limit = min(args.max_pages, FALLBACK_DISCOVERY_CAP)
        discovery_meta["fallback_discovery_limit"] = fallback_discovery_limit
        reporter.warn(f"Fallback discovery limit set to {fallback_discovery_limit} pages.")

        crawled = crawl_discover(start_url, session, args.timeout, fallback_discovery_limit, args.max_depth, args.include_subdomains, reporter)
        discovery_meta["static_bounded_crawl_urls"] = len(crawled)

        rendered_discovered = []
        if args.mixed_discovery:
            root_host = urllib.parse.urlparse(start_url).hostname or ""
            # Estimate fallback-capped sample before rendered discovery so the discovery effort scales with it.
            estimated_discovered_count = max(1, min(fallback_discovery_limit, len(set(discovered + crawled))))
            estimated_sample_count = effective_sample_size(args.max_samples, estimated_discovered_count, sitemap_insufficient=True)
            effective_render_seed_pages = effective_render_discovery_pages(estimated_sample_count, args.render_discovery_pages)

            # Seeds come from sitemap URLs if present, otherwise static crawl discovery.
            seed_pool = list(dict.fromkeys(discovered + crawled))
            seed_sample, _ = stratified_sample(seed_pool, min(effective_render_seed_pages, len(seed_pool)), args.sample_seed)
            if seed_sample:
                reporter.done(f"{len(seed_sample)} pages selected for rendered discovery")
                rendered_discovered = rendered_link_discover(
                    seed_sample,
                    args.render_timeout,
                    root_host,
                    args.include_subdomains,
                    effective_render_seed_pages,
                    args.render_discovery_links_per_page,
                    scroll=not args.no_scroll,
                    reporter=reporter,
                )
            discovery_meta["rendered_discovery_urls"] = len(rendered_discovered)
            discovery_meta["effective_render_discovery_pages"] = effective_render_seed_pages

        discovered = list(dict.fromkeys(discovered + crawled + rendered_discovered))[: fallback_discovery_limit]
        reporter.done(f"{len(discovered)} total URLs discovered from sitemap/static/rendered sources")

    if not discovered:
        return {"domain": args.domain, "error": "No pages sampled", "domain_recommendation": "insufficient-data", "metrics": {"confidence": "none"}}

    args.max_samples = effective_sample_size(args.max_samples, len(discovered), sitemap_insufficient)

    if args.render_pages is None:
        args.render_pages = adaptive_render_pages(args.max_samples)
    else:
        args.render_pages = min(args.render_pages, adaptive_render_pages(args.max_samples) if sitemap_insufficient else args.render_pages)

    if not reporter.quiet:
        reporter.info(f"\nAdaptive settings in use")
        reporter.info(f"  max-pages: {discovery_meta.get('fallback_discovery_limit', args.max_pages)}" + (" (fallback-capped)" if discovery_meta.get("sitemap_insufficient") else ""))
        reporter.info(f"  max-samples: {args.max_samples}" + (" (fallback-capped)" if discovery_meta.get("sitemap_insufficient") else ""))
        reporter.info(f"  render-check: {'on' if args.render_check else 'off'}")
        reporter.info(f"  render-pages: {args.render_pages if args.render_check else 0}")
        reporter.info(f"  include-subdomains: {'on' if args.include_subdomains else 'off'}")
        reporter.info(f"  mixed-discovery: {'on' if args.mixed_discovery else 'off'}")
        reporter.info(f"  render-discovery-pages: {args.render_discovery_pages}")
        reporter.info(f"  workers: {args.workers}")
        reporter.info(f"  timeout: {args.timeout}s")
        reporter.info(f"  progress-every: {args.progress_every}s")

    reporter.stage(2, total_stages, "Building stratified sample")
    sampled, sample_stats_data = stratified_sample(discovered, args.max_samples, args.sample_seed)
    print_sample_distribution(sample_stats_data, reporter)
    reporter.done(f"Final sample: {len(sampled)} pages")

    reporter.stage(3, total_stages, "Static analysis")
    static_results = []
    start = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futures = [ex.submit(analyze_static_url, u, args.timeout) for u in sampled]
        for fut in concurrent.futures.as_completed(futures):
            result = fut.result()
            static_results.append(result)
            reporter.progress(len(static_results), len(sampled), start, "Static analysis", metrics=static_progress_metrics(static_results), latest_url=result.url)
            reporter.detail(f"  {result.recommendation:<32} B={result.browsertrix_score} H={result.heritrix_score} {result.url}")

    static_results = sorted(static_results, key=lambda r: (r.raw.depth, r.url))
    reporter.progress(len(static_results), len(sampled), start, "Static analysis", force=True, metrics=static_progress_metrics(static_results), latest_url=(static_results[-1].url if static_results else None))

    results = static_results

    if args.render_check:
        reporter.stage(4, total_stages, "Selecting render candidates")
        root_host = urllib.parse.urlparse(start_url).hostname or ""
        targets, render_reason_counts = choose_render_subset(static_results, min(args.render_pages, len(static_results)))
        reporter.done(f"{len(targets)} pages selected for rendering")
        if render_reason_counts and not reporter.quiet:
            reporter.info("\nRender candidate reasons")
            for k, v in sorted(render_reason_counts.items(), key=lambda kv: (-kv[1], kv[0])):
                reporter.info(f"  {k:<28} {v}")

        reporter.stage(5, total_stages, "Render comparison")
        results = add_render_results(static_results, targets, args.render_timeout, scroll=not args.no_scroll, root_host=root_host, include_subdomains=args.include_subdomains, reporter=reporter)
        reporter.done(f"Render phase complete. Live recommendation: {live_recommendation(results)}")

        assess_stage = 6
    else:
        assess_stage = 4

    reporter.stage(assess_stage, total_stages, "Domain assessment")
    rec, metrics = domain_recommendation(results)
    reporter.done(f"Current recommendation: {rec.upper()} ({metrics.get('confidence', 'unknown')} confidence)")

    payload = result_payload(args, start_url, discovered, sampled, sample_stats_data, results, discovery_meta)

    if args.report_dir:
        reporter.stage(total_stages, total_stages, "Writing report files")
        write_reports(args.report_dir, payload, reporter)

    reporter.finish_progress()
    return payload


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Recommend Heritrix vs Browsertrix for a domain.")
    ap.add_argument("target", help="Domain/start URL, or a file containing one domain per line.")
    ap.add_argument("--max-pages", type=int, default=None, help="Maximum URLs to discover from sitemap/crawl before sampling. Adaptive default: 10000")
    ap.add_argument("--max-samples", type=int, default=None, help="Maximum sampled pages to analyze. Adaptive default: 60/100/200/300 based on discovered URLs")
    ap.add_argument("--sample-seed", type=int, default=13, help="Random seed for stratified remainder sampling. Default: 13")
    ap.add_argument("--max-depth", type=int, default=4, help="Max crawl depth if sitemap is insufficient. Default: 4")
    ap.add_argument("--mixed-discovery", dest="mixed_discovery", action="store_true", default=True, help="When sitemaps are insufficient, discover URLs from both static and rendered crawls. Default: on")
    ap.add_argument("--no-mixed-discovery", dest="mixed_discovery", action="store_false", help="Use only static bounded crawl when sitemaps are insufficient.")
    ap.add_argument("--render-discovery-pages", type=int, default=12, help="Maximum seed pages to render for fallback URL discovery. Default: 12")
    ap.add_argument("--render-discovery-links-per-page", type=int, default=120, help="Maximum rendered links to collect per seed page. Default: 120")
    ap.add_argument("--max-sitemaps", type=int, default=30, help="Maximum sitemap files to inspect. Default: 30")
    ap.add_argument("--include-subdomains", dest="include_subdomains", action="store_true", default=True, help="Include subdomains in scope. Default: on")
    ap.add_argument("--no-include-subdomains", dest="include_subdomains", action="store_false", help="Restrict analysis to the exact target hostname.")
    ap.add_argument("--timeout", type=float, default=None, help="HTTP timeout seconds for static fetch. Adaptive default: 15")
    ap.add_argument("--workers", type=int, default=None, help="Concurrent static analysis workers. Adaptive default: min(32, CPU*2)")
    ap.add_argument("--render-check", dest="render_check", action="store_true", default=True, help="Render a subset of sampled pages with Playwright and compare raw vs rendered. Default: on")
    ap.add_argument("--no-render-check", dest="render_check", action="store_false", help="Disable Playwright render comparison.")
    ap.add_argument("--render-pages", type=int, default=None, help="Maximum pages to render. Adaptive default: 20%% of sample, capped at 50")
    ap.add_argument("--render-timeout", type=int, default=20000, help="Playwright page timeout in ms. Default: 20000")
    ap.add_argument("--no-scroll", action="store_true", help="Disable scrolling during render checks.")
    ap.add_argument("--json", action="store_true", help="Emit JSON instead of text report. In batch mode emits a JSON array.")
    ap.add_argument("--tsv", action="store_true", help="Emit TSV: domain, recommendation, confidence. Useful for batch lists.")
    ap.add_argument("--tsv-header", action="store_true", help="Include a TSV header row when using --tsv.")
    ap.add_argument("--report-dir", help="Write JSON, CSV, and HTML reports to this directory.")
    ap.add_argument("--quiet", action="store_true", help="Suppress progress/status messages.")
    ap.add_argument("--progress-to-stderr", action="store_true", default=True, help="Send progress/status messages to stderr so stdout can be piped. Default: on")
    ap.add_argument("--progress-to-stdout", dest="progress_to_stderr", action="store_false", help="Send progress/status messages to stdout instead of stderr.")
    ap.add_argument("--show-progress-with-output", action="store_true", help="Show progress even when using --json or --tsv; progress goes to stderr by default.")
    ap.add_argument("--verbose", action="store_true", help="Print page-level diagnostics.")
    ap.add_argument("--progress-every", type=float, default=None, help="Seconds between progress updates. Adaptive default: 2")
    args = adaptive_defaults(ap.parse_args(argv))


    is_batch, domains = load_targets(args.target)
    if not domains:
        print("No domains found.", file=sys.stderr)
        return 2

    payloads: list[dict] = []
    machine_output = args.json or args.tsv
    base_quiet = args.quiet

    batch_start = time.time()
    progress_stream = sys.stderr if getattr(args, "progress_to_stderr", True) else sys.stdout

    show_machine_progress = bool(machine_output and args.show_progress_with_output)
    dual_progress = DualProgress(stream=progress_stream, quiet=not (is_batch and show_machine_progress))
    batch_reporter = Reporter(
        quiet=(args.quiet and not show_machine_progress),
        verbose=False,
        progress_every=args.progress_every,
        stream=progress_stream,
        dual_progress=(dual_progress if is_batch and show_machine_progress else None),
        role="overall",
    )

    if is_batch and not machine_output and not args.quiet:
        print(f"Batch mode: {len(domains)} domains\n")

    for idx, domain in enumerate(domains, start=1):
        domain_args = copy.deepcopy(args)
        domain_args.domain = domain
        # Keep machine-readable stdout clean in JSON/TSV mode by sending progress to stderr.
        domain_args.quiet = base_quiet and not show_machine_progress
        domain_args.dual_progress = dual_progress if is_batch and show_machine_progress else None
        domain_args.report_dir = derive_report_dir(args.report_dir, domain, is_batch)

        if is_batch:
            batch_reporter.progress(
                idx - 1,
                len(domains),
                batch_start,
                "Overall batch",
                force=True,
                metrics={"completed": idx - 1},
                latest_url=domain,
            )

        payload = analyze_domain(domain_args)
        payloads.append(payload)

        if args.tsv and not args.json:
            if idx == 1 and args.tsv_header:
                print("domain\tdomain_recommendation\tconfidence")
            print(tsv_line(payload), flush=True)

        if is_batch:
            batch_reporter.progress(
                idx,
                len(domains),
                batch_start,
                "Overall batch",
                force=True,
                metrics={"completed": idx},
                latest_url=domain,
            )

    batch_reporter.finish_progress()
    if is_batch and show_machine_progress:
        dual_progress.finish()

    if args.tsv:
        return 0

    if args.json:
        if is_batch:
            print(json.dumps(payloads, indent=2, sort_keys=True))
        else:
            print(json.dumps(payloads[0], indent=2, sort_keys=True))
        return 0

    if is_batch:
        print_tsv(payloads, header=True)
    elif not args.quiet:
        print_payload_summary(payloads[0])
    else:
        p = payloads[0]
        print(f"{p.get('domain_recommendation')} ({(p.get('metrics') or {}).get('confidence', 'unknown')})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
