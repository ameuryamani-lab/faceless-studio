"""Faceless Studio: public counts of our own published videos (yt-dlp metadata only: no download, no account, no cookies).

Run with the yt-dlp Python (core/trends.mjs PYTHON) in isolated mode:  python -I workshop/metrics_fetch.py < {"urls": [...]}
Prints a JSON list: {url, ok, views, likes, comments, shares, uploader_id, channel_url, error}.
YouTube is reliable; TikTok is best effort (its pages often refuse anonymous reads). Instagram is never asked here.
"""
import json
import re
import sys
import time

MAX_URLS = 60
SLEEP_S = 1.0
TIMEOUT_S = 180


def as_int(v):
    return int(v) if isinstance(v, (int, float)) else None


def main():
    import yt_dlp
    cfg = json.loads(sys.stdin.read() or '{}')
    urls = [u for u in cfg.get('urls') or [] if isinstance(u, str) and re.match(r'^https://(www\.|m\.|vm\.)?(youtube\.com|youtu\.be|tiktok\.com)/', u)][:MAX_URLS]
    deadline = time.monotonic() + TIMEOUT_S
    opts = {'quiet': True, 'no_warnings': True, 'skip_download': True, 'socket_timeout': 15, 'retries': 1, 'cachedir': False, 'noplaylist': True}
    out = []
    with yt_dlp.YoutubeDL(opts) as y:
        for i, url in enumerate(urls):
            if time.monotonic() > deadline:
                out.append({'url': url, 'ok': False, 'error': 'time budget used up'})
                continue
            if i:
                time.sleep(SLEEP_S)
            try:
                info = y.extract_info(url, download=False, process=False)
                out.append({'url': url, 'ok': True, 'views': as_int(info.get('view_count')), 'likes': as_int(info.get('like_count')),
                            'comments': as_int(info.get('comment_count')), 'shares': as_int(info.get('repost_count')),
                            'uploader_id': info.get('uploader_id') or info.get('uploader'), 'channel_url': info.get('channel_url') or info.get('uploader_url')})
            except Exception as e:  # one failure never stops the others
                out.append({'url': url, 'ok': False, 'error': re.sub(r'\s+', ' ', str(e))[:200]})
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main()
