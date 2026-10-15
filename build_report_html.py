#!/usr/bin/env python3
"""Bundle the local report assets into one Apps Script HtmlService file.

Google Apps Script's HTML editor stores a single HTML file as `Report.html`.
This script copies the current project sources, embeds its CSS, JavaScript and
logo, and keeps the HTTPS Chart.js and XLSX CDN dependencies intact.
"""

from __future__ import annotations

import argparse
import base64
from html.parser import HTMLParser
from pathlib import Path
import re


DEFAULT_PROJECT = Path(__file__).resolve().parent


def replace_once(source: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, lambda match: replacement, source, flags=re.IGNORECASE | re.DOTALL)
    if count != 1:
        raise ValueError(f"Expected one {label}; found {count}")
    return result


def validate_assets(html: str, css: str) -> None:
    class AssetParser(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.local_assets: list[str] = []

        def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
            for key, value in attrs:
                if key not in {"href", "src"} or not value:
                    continue
                if value.startswith(("https://", "data:", "#", "mailto:", "tel:")):
                    continue
                self.local_assets.append(f"{tag}[{key}]={value}")

    parser = AssetParser()
    parser.feed(html)
    if parser.local_assets:
        raise ValueError(f"Local assets remain: {parser.local_assets}")

    css_urls = re.findall(r"url\(\s*(['\"]?)(.*?)\1\s*\)", css, flags=re.IGNORECASE)
    for _, value in css_urls:
        if value and not value.startswith(("https://", "data:", "#")):
            raise ValueError(f"Local CSS URL remains: {value}")


def build(project: Path, output: Path) -> int:
    html = (project / "index.html").read_text(encoding="utf-8")
    css = (project / "styles.css").read_text(encoding="utf-8")
    js = (project / "app.js").read_text(encoding="utf-8")
    logo = base64.b64encode((project / "pllet-logo.png").read_bytes()).decode("ascii")

    # A literal closing tag terminates an inline script/style in the HTML
    # parser, even if that text occurs in a JavaScript/CSS string or comment.
    js = re.sub(r"</script", r"<\\/script", js, flags=re.IGNORECASE)
    css = re.sub(r"</style", r"<\\/style", css, flags=re.IGNORECASE)

    html = replace_once(
        html,
        r"<link\b(?=[^>]*\bhref\s*=\s*['\"](?:\./)?styles\.css(?:\?[^'\"]*)?['\"])[^>]*>",
        f"<style>\n{css}\n</style>",
        "local stylesheet",
    )
    html = replace_once(
        html,
        r"<script\b(?=[^>]*\bsrc\s*=\s*['\"](?:\./)?app\.js(?:\?[^'\"]*)?['\"])[^>]*>\s*</script\s*>",
        f"<script>\n{js}\n</script>",
        "local app script",
    )
    html, image_count = re.subn(
        r"(?P<attr>\b(?:src|href)\s*=\s*)(?P<quote>['\"])(?:\./)?pllet-logo\.png(?:\?[^'\"]*)?(?P=quote)",
        lambda match: f"{match.group('attr')}{match.group('quote')}data:image/png;base64,{logo}{match.group('quote')}",
        html,
        flags=re.IGNORECASE,
    )
    if image_count < 2:
        raise ValueError(f"Expected logo in at least two locations; found {image_count}")

    validate_assets(html, css)
    output.write_text(html, encoding="utf-8")
    return output.stat().st_size


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=DEFAULT_PROJECT)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    project = args.project.resolve()
    output = (args.output or project / "Report.html").resolve()
    size = build(project, output)
    print(f"Bundled {output} ({size:,} bytes)")


if __name__ == "__main__":
    main()
