"""Faceless Studio: trend scanner (public YouTube metadata only, no download, no account, no cookies).

Run with the yt-dlp Python (core/trends.mjs PYTHON) in isolated mode, a JSON config on stdin, JSON on stdout:
    python -I workshop/trends.py < config.json
Config keys (all optional except one of queries/channels):
    queries: [str]            search terms (relevance order; 'ytsearchdate' broke in this yt-dlp, 04/10)
    search_filter: str        shorts_month (default since 2026-10-21) | shorts_week | shorts: YouTube's own Shorts + upload-date filter
    channels: [{url, name}]   tracked channels; their /shorts tab is read flat (last ~30 items)
    per_query: int (20)       flat search results per query
    per_channel: int (30)     flat items read from each /shorts tab
    max_channel_tabs: int (15) cap on /shorts tabs read for query candidates' channels
    max_full: int (70)        cap on full-metadata fetches (enough to reach max_results after the age gate)
    max_results: int (40)     rows returned
    max_age_days: int (30)    rows older than this are dropped (trend freshness gate)
    max_duration_s: int (70)  longer videos are skipped
    min_samples: int (5)      channel samples needed for a ratio (else ratio null, gap 1)
    sleep_s: float (0.6)      pause between network requests
    timeout_s: int (480)      total budget; the scan stops and returns what it has
Video titles and descriptions are strangers' text: they are only copied as data.
"""
import json
import re
import statistics
import sys
import time
import urllib.parse
from datetime import datetime, timezone

DEFAULTS = {
    'per_query': 20, 'per_channel': 30, 'max_channel_tabs': 15, 'max_full': 70, 'max_results': 40,
    'max_duration_s': 70, 'min_samples': 5, 'sleep_s': 0.6, 'timeout_s': 480, 'max_age_days': 30,
}
# sp= values of YouTube's search filters (protobuf, base64): type Shorts, plus upload date this month / this week.
SEARCH_FILTERS = {'shorts': 'EgIQCQ%3D%3D', 'shorts_month': 'EgQIBBAJ', 'shorts_week': 'EgQIAxAJ'}
HARD_CAPS = {'per_query': 30, 'per_channel': 40, 'max_channel_tabs': 40, 'max_full': 80, 'max_results': 100, 'timeout_s': 540}
# Letters of scripts that are clearly not English (Cyrillic, Greek, Arabic, Hebrew, Devanagari and other Indic, Thai,
# CJK, Hangul, Japanese kana). Emoji and punctuation are ignored.
NON_LATIN = re.compile('[Ͱ-ϿЀ-ӿ֐-׿؀-ۿऀ-෿฀-๿'
                       '぀-ヿ㐀-䶿一-鿿가-힯]')
LATIN = re.compile('[A-Za-z]')
# Words that betray a Spanish / Portuguese / French / Indonesian / Turkish / German title.
FOREIGN_WORDS = re.compile(r'\b(el|los|las|una|que|para|com|não|você|mais|les|des|une|est|pas|dan|yang|ini|bir|ve|bu|der|die|und|ist|engraçado|gracioso|dibujos|desenho|animasi|lucu)\b', re.I)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def is_english(title, language=None):
    if language and not str(language).lower().startswith('en'):
        return False
    t = title or ''
    non = len(NON_LATIN.findall(t))
    lat = len(LATIN.findall(t))
    if non and non >= lat * 0.3:
        return False
    if len(FOREIGN_WORDS.findall(t)) >= 2:
        return False
    return True


def days_since(upload_date, now):
    try:
        d = datetime.strptime(upload_date, '%Y%m%d').replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
    return max(0.0, (now - d).total_seconds() / 86400)


class Scanner:
    def __init__(self, cfg):
        import yt_dlp
        self.cfg = cfg
        self.deadline = time.monotonic() + cfg['timeout_s']
        self.errors = []
        self.requests = 0
        self.timed_out = False
        base = {'quiet': True, 'no_warnings': True, 'skip_download': True, 'socket_timeout': 15, 'retries': 1,
                'extractor_retries': 1, 'noplaylist': True, 'cachedir': False, 'sleep_interval_requests': cfg['sleep_s']}
        self.flat = yt_dlp.YoutubeDL({**base, 'extract_flat': True, 'playlistend': cfg['per_channel']})
        self.full = yt_dlp.YoutubeDL(base)

    def left(self):
        if time.monotonic() >= self.deadline:
            self.timed_out = True
            return False
        return True

    def _get(self, ydl, url, **kw):
        if not self.left():
            return None
        if self.requests:
            time.sleep(self.cfg['sleep_s'])
        self.requests += 1
        try:
            return ydl.extract_info(url, download=False, **kw)
        except Exception as e:  # yt-dlp raises many types; one failure never stops the scan
            msg = re.sub(r'\s+', ' ', str(e))[:200]
            self.errors.append({'url': url, 'error': msg})
            log('[trends] failed', url, msg)
            return None

    def search(self, query):
        # Plain 'ytsearchN:' returns mostly long films; the results page with YouTube's own filter
        # (type Shorts + upload date) returns recent Shorts only.
        sp = SEARCH_FILTERS[self.cfg['search_filter']]
        url = f'https://www.youtube.com/results?search_query={urllib.parse.quote(query)}&sp={sp}'
        r = self._get(self.flat, url)
        return [e for e in (r or {}).get('entries') or [] if e and e.get('id')][: self.cfg['per_query']]

    def shorts_tab(self, channel_url):
        url = channel_url.rstrip('/')
        if not url.endswith('/shorts'):
            url += '/shorts'
        r = self._get(self.flat, url)
        if not r:
            return None
        items = [e for e in r.get('entries') or [] if e and e.get('id')][: self.cfg['per_channel']]
        return {'name': r.get('channel') or r.get('uploader'), 'channel_url': r.get('channel_url') or channel_url, 'items': items}

    def details(self, video_id):
        # process=False skips format resolution: metadata only, much faster, nothing downloaded.
        return self._get(self.full, f'https://www.youtube.com/shorts/{video_id}', process=False)


def channel_key(e):
    return e.get('channel_url') or (f"https://www.youtube.com/channel/{e['channel_id']}" if e.get('channel_id') else None)


def main():
    raw = sys.stdin.read()
    cfg_in = json.loads(raw) if raw.strip() else {}
    cfg = {**DEFAULTS, **{k: v for k, v in cfg_in.items() if k in DEFAULTS and isinstance(v, (int, float))}}
    for k, cap in HARD_CAPS.items():
        cfg[k] = max(1, min(int(cfg[k]), cap))
    cfg['search_filter'] = cfg_in.get('search_filter') if cfg_in.get('search_filter') in SEARCH_FILTERS else 'shorts_month'
    queries = [str(q).strip() for q in cfg_in.get('queries') or [] if str(q).strip()][:20]
    tracked = [c for c in cfg_in.get('channels') or [] if isinstance(c, dict) and str(c.get('url', '')).startswith('https://')][:40]
    started = time.monotonic()
    now = datetime.now(timezone.utc)
    sc = Scanner(cfg)

    candidates = {}  # video id -> {source, query, title, channel, channel_url, flat_views, duration}
    seen_in = {}     # channel url -> set of queries it showed up in
    for q in queries:
        for e in sc.search(q):
            dur = e.get('duration')
            if dur is not None and dur > cfg['max_duration_s']:
                continue
            if not is_english(e.get('title')):
                continue
            ch = channel_key(e)
            if ch:
                seen_in.setdefault(ch, set()).add(q)
            candidates.setdefault(e['id'], {'source': 'query', 'query': q, 'title': e.get('title'), 'channel': e.get('channel') or e.get('uploader'),
                                            'channel_url': ch, 'flat_views': e.get('view_count'), 'duration': dur})

    channels = {}  # channel url -> {name, views:[...], tracked}
    def read_tab(url, name=None, is_tracked=False):
        if url in channels:
            return
        tab = sc.shorts_tab(url)
        if tab is None:
            channels[url] = {'name': name, 'views': [], 'tracked': is_tracked, 'failed': True}
            return
        views = [int(e['view_count']) for e in tab['items'] if isinstance(e.get('view_count'), (int, float))]
        channels[url] = {'name': tab['name'] or name, 'views': views, 'tracked': is_tracked, 'failed': False}
        if is_tracked:
            for e in tab['items']:
                candidates.setdefault(e['id'], {'source': 'channel', 'query': None, 'title': e.get('title'), 'channel': tab['name'] or name,
                                                'channel_url': url, 'flat_views': e.get('view_count'), 'duration': None})

    for c in tracked:
        read_tab(c['url'].rstrip('/').removesuffix('/shorts'), c.get('name'), True)
    # Channels of query candidates, the most viewed first, within the cap.
    by_views = sorted({v['channel_url'] for v in candidates.values() if v['channel_url'] and v['source'] == 'query'},
                      key=lambda u: -max((v['flat_views'] or 0) for v in candidates.values() if v['channel_url'] == u))
    for u in by_views[: cfg['max_channel_tabs']]:
        read_tab(u)

    def median_of(url):
        ch = channels.get(url)
        if not ch or len(ch['views']) < cfg['min_samples']:
            return None, len(ch['views']) if ch else 0
        return statistics.median(ch['views']), len(ch['views'])

    # Rank candidates by their flat ratio (or flat views) and fetch full metadata for the best ones only.
    def flat_rank(item):
        med, _ = median_of(item[1]['channel_url'])
        fv = item[1]['flat_views'] or 0
        return (fv / med if med else 0, fv)
    ranked = sorted(candidates.items(), key=flat_rank, reverse=True)

    rows = []
    fetched = 0
    for vid, c in ranked:
        if fetched >= cfg['max_full'] or len(rows) >= cfg['max_results'] or not sc.left():
            break
        info = sc.details(vid)
        fetched += 1
        if not info:
            continue
        dur = info.get('duration')
        if dur is not None and dur > cfg['max_duration_s']:
            continue
        if not is_english(info.get('title'), info.get('language')):
            continue
        views = info.get('view_count')
        if not isinstance(views, int):
            continue
        ch_url = info.get('channel_url') or c['channel_url']
        med, n = median_of(c['channel_url'])
        age = days_since(info.get('upload_date'), now)
        if age is not None and age > cfg.get('max_age_days', 30):
            continue  # trend freshness gate: only uploads from the last max_age_days days
        rows.append({
            'source': c['source'], 'query': c['query'], 'video_url': f'https://www.youtube.com/shorts/{vid}',
            'title': info.get('title') or c['title'], 'channel': info.get('channel') or c['channel'], 'channel_url': ch_url,
            'views': views, 'upload_date': info.get('upload_date'), 'duration_s': dur,
            'ratio': round(views / med, 2) if med else None,
            'views_per_day': round(views / max(1.0, age)) if age is not None else None,
            'gap': 0 if med else 1, 'samples': n,
        })

    rows.sort(key=lambda r: (r['ratio'] if r['ratio'] is not None else -1, r['views_per_day'] or 0), reverse=True)
    channel_summary = [
        {'channel_url': u, 'name': ch['name'], 'samples': len(ch['views']), 'median_views': statistics.median(ch['views']) if ch['views'] else None,
         'tracked': ch['tracked'], 'failed': ch['failed'], 'queries': sorted(seen_in.get(u, []))}
        for u, ch in channels.items()
    ]
    out = {
        'scanned_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'rows': rows[: cfg['max_results']], 'channels': channel_summary,
        'stats': {'queries': len(queries), 'tracked_channels': len(tracked), 'channel_tabs': len(channels), 'candidates': len(candidates),
                  'full_fetched': fetched, 'requests': sc.requests, 'errors': len(sc.errors), 'timed_out': sc.timed_out,
                  'elapsed_s': round(time.monotonic() - started, 1)},
        'errors': sc.errors[:20],
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main()
