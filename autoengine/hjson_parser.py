"""
Pure-Python zero-dependency HJSON (Human JSON) parser for Obsidian Cut AutoEngine.

Supports:
  - `#` and `//` line comments and `/* ... */` block comments
  - Optional root `{ ... }` braces
  - Unquoted object keys
  - Quoteless single-line string values (preserving hex colors like `#3b82f6` and URLs)
  - Multiline `''' ... '''` strings with common-indent dedenting
  - Double-quoted and single-quoted strings with standard escapes
  - Newline-separated entries and trailing commas
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


class HjsonDecodeError(ValueError):
    """Raised when an HJSON document contains invalid syntax."""


_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{3,8}$")
_NUM_RE = re.compile(r"^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$")


class _HjsonParser:
    def __init__(self, text: str) -> None:
        # Normalize BOM and CRLF
        if text.startswith("\ufeff"):
            text = text[1:]
        self.src = text.replace("\r\n", "\n").replace("\r", "\n")
        self.n = len(self.src)
        self.pos = 0

    def _error(self, msg: str) -> HjsonDecodeError:
        line = self.src.count("\n", 0, self.pos) + 1
        last_nl = self.src.rfind("\n", 0, self.pos)
        col = self.pos - last_nl
        return HjsonDecodeError(f"{msg} (line {line}, column {col})")

    def _skip_ws_and_comments(self, stop_at_newline: bool = False) -> None:
        while self.pos < self.n:
            ch = self.src[self.pos]
            if ch in (" ", "\t"):
                self.pos += 1
                continue
            if ch == "\n":
                if stop_at_newline:
                    break
                self.pos += 1
                continue
            if ch == "#":
                while self.pos < self.n and self.src[self.pos] != "\n":
                    self.pos += 1
                continue
            if ch == "/" and self.pos + 1 < self.n:
                nxt = self.src[self.pos + 1]
                if nxt == "/":
                    while self.pos < self.n and self.src[self.pos] != "\n":
                        self.pos += 1
                    continue
                if nxt == "*":
                    end = self.src.find("*/", self.pos + 2)
                    if end == -1:
                        raise self._error("Unterminated /* ... */ block comment")
                    self.pos = end + 2
                    continue
            break

    def _skip_sep_and_comments(self) -> None:
        while self.pos < self.n:
            self._skip_ws_and_comments(stop_at_newline=False)
            if self.pos < self.n and self.src[self.pos] == ",":
                self.pos += 1
                continue
            break

    def _parse_quoted_string(self, quote_char: str) -> str:
        start = self.pos
        self.pos += 1  # consume opening quote
        out: list[str] = []
        while self.pos < self.n:
            ch = self.src[self.pos]
            if ch == quote_char:
                self.pos += 1
                return "".join(out)
            if ch == "\\":
                self.pos += 1
                if self.pos >= self.n:
                    raise self._error("Unterminated escape sequence in string")
                esc = self.src[self.pos]
                self.pos += 1
                simple = {
                    '"': '"',
                    "'": "'",
                    "\\": "\\",
                    "/": "/",
                    "b": "\b",
                    "f": "\f",
                    "n": "\n",
                    "r": "\r",
                    "t": "\t",
                }
                if esc in simple:
                    out.append(simple[esc])
                elif esc == "u":
                    hex_part = self.src[self.pos : self.pos + 4]
                    if len(hex_part) < 4 or not re.fullmatch(r"[0-9a-fA-F]{4}", hex_part):
                        raise self._error("Invalid \\uXXXX escape")
                    out.append(chr(int(hex_part, 16)))
                    self.pos += 4
                else:
                    out.append(esc)
            elif ch == "\n":
                raise self._error(f"Unescaped newline in quoted string starting at offset {start}")
            else:
                out.append(ch)
                self.pos += 1
        raise self._error("Unterminated quoted string")

    def _parse_multiline_string(self) -> str:
        self.pos += 3  # consume '''
        # Ignore remaining whitespace on opening ''' line
        while self.pos < self.n and self.src[self.pos] in (" ", "\t"):
            self.pos += 1
        if self.pos < self.n and self.src[self.pos] == "\n":
            self.pos += 1

        end = self.src.find("'''", self.pos)
        if end == -1:
            raise self._error("Unterminated multiline ''' string")

        raw = self.src[self.pos : end]
        self.pos = end + 3

        lines = raw.split("\n")
        # Strip trailing blank line right before closing '''
        if lines and lines[-1].strip() == "":
            lines.pop()

        non_empty_indents = [
            len(ln) - len(ln.lstrip(" \t"))
            for ln in lines
            if ln.strip() != ""
        ]
        min_indent = min(non_empty_indents) if non_empty_indents else 0
        dedented = [ln[min_indent:] if len(ln) >= min_indent else "" for ln in lines]
        return "\n".join(dedented)

    @staticmethod
    def _strip_inline_comment(raw: str) -> str:
        """
        Strips trailing `# ...` or `// ...` comments from a single-line quoteless token,
        while preserving hex colors (`#3b82f6`) and URLs (`https://...`).
        """
        in_token = raw.strip()
        if not in_token:
            return ""
        # Check for whitespace followed by `#` or `//`
        for idx in range(len(in_token)):
            if in_token[idx] in (" ", "\t"):
                rest = in_token[idx:].lstrip(" \t")
                if rest.startswith("#") and not _HEX_COLOR_RE.match(rest.split()[0]):
                    return in_token[:idx].rstrip()
                if rest.startswith("//"):
                    return in_token[:idx].rstrip()
                if rest.startswith("#") and idx > 0:
                    # Comment like `30 # frames per sec`
                    return in_token[:idx].rstrip()
        return in_token

    @staticmethod
    def _coerce_primitive(token: str) -> Any:
        if token == "true":
            return True
        if token == "false":
            return False
        if token == "null":
            return None
        if _NUM_RE.match(token):
            if "." in token or "e" in token or "E" in token:
                return float(token)
            return int(token)
        return token

    def _parse_quoteless_value(self, in_array: bool = False) -> Any:
        # Read until newline, stripping optional trailing comma / inline comment
        start = self.pos
        while self.pos < self.n and self.src[self.pos] != "\n":
            self.pos += 1
        raw = self.src[start:self.pos].strip()

        # Handle comma-separated primitives on a single line like `[1, 2, 3]` or `{ a: 1, b: 2 }`
        # If there's a closing bracket or comma before newline and not a plain sentence
        if in_array:
            # Stop at unquoted `,` or `]` if on same line
            pass

        cleaned = self._strip_inline_comment(raw)
        if cleaned.endswith(","):
            cleaned = cleaned[:-1].rstrip()
        return self._coerce_primitive(cleaned)

    def _parse_array_quoteless_or_inline(self) -> Any:
        # Inside `[ ... ]`, single-line primitives/tokens may be separated by `,` or terminated by `]`
        start = self.pos
        # Scan until newline, `,`, or `]` unless quotes or comment appear
        while self.pos < self.n:
            ch = self.src[self.pos]
            if ch in ("\n", ",", "]"):
                break
            if ch == "#" and self.pos > start and self.src[self.pos - 1] in (" ", "\t"):
                break
            if ch == "/" and self.pos + 1 < self.n and self.src[self.pos + 1] == "/" and self.pos > start and self.src[self.pos - 1] in (" ", "\t"):
                break
            self.pos += 1
        raw = self.src[start:self.pos].strip()
        if self.pos < self.n and self.src[self.pos] == "#":
            while self.pos < self.n and self.src[self.pos] != "\n":
                self.pos += 1
        elif self.pos < self.n and self.src[self.pos : self.pos + 2] == "//":
            while self.pos < self.n and self.src[self.pos] != "\n":
                self.pos += 1
        return self._coerce_primitive(raw)

    _INLINE_NEXT_KEY_RE = re.compile(r',\s*(?:[A-Za-z_][A-Za-z0-9_\-]*|"[^"]*"|\'[^\']*\')\s*:')

    def _parse_object_quoteless_inline_safe(self, braced: bool = True) -> Any:
        start = self.pos
        line_end = self.src.find("\n", self.pos)
        if line_end == -1:
            line_end = self.n
        segment = self.src[start:line_end]

        # Check for inline `, nextKey:` separator in single-line objects like `{ a: foo bar, b: baz }`
        m_next = self._INLINE_NEXT_KEY_RE.search(segment)
        # Check for closing `}` on same line in braced objects like `{ a: 1, b: video }`
        close_idx = segment.find("}") if braced else -1

        cut_idx: int | None = None
        if m_next is not None:
            cut_idx = m_next.start()
        if close_idx != -1 and (cut_idx is None or close_idx < cut_idx):
            cut_idx = close_idx

        if cut_idx is not None:
            raw = segment[:cut_idx].strip()
            self.pos = start + cut_idx
            return self._coerce_primitive(raw)

        self.pos = line_end
        stripped = self._strip_inline_comment(segment)
        if stripped.endswith(","):
            stripped = stripped[:-1].rstrip()
        return self._coerce_primitive(stripped)

    def _parse_key(self) -> str:
        ch = self.src[self.pos]
        if ch in ('"', "'"):
            return self._parse_quoted_string(ch)
        start = self.pos
        while self.pos < self.n:
            c = self.src[self.pos]
            if c in (":", "\n", " ", "\t", "{", "}", "[", "]", ","):
                break
            self.pos += 1
        key = self.src[start:self.pos].strip()
        if not key:
            raise self._error("Expected object key")
        return key

    def parse_value(self, context: str = "root") -> Any:
        if context in ("object", "object_rootless"):
            self._skip_ws_and_comments(stop_at_newline=True)
            if self.pos < self.n and self.src[self.pos] == "\n":
                # Look ahead past blank lines/comments to see if a block `{`, `[`, or `'''` follows
                saved = self.pos
                self._skip_ws_and_comments(stop_at_newline=False)
                if self.pos < self.n and (self.src[self.pos] in ("{", "[") or self.src.startswith("'''", self.pos)):
                    pass
                else:
                    self.pos = saved
                    return ""
        else:
            self._skip_ws_and_comments(stop_at_newline=False)

        if self.pos >= self.n:
            raise self._error("Unexpected end of HJSON input")

        ch = self.src[self.pos]
        if ch == "{":
            return self.parse_object(braced=True)
        if ch == "[":
            return self.parse_array()
        if self.src.startswith("'''", self.pos):
            return self._parse_multiline_string()
        if ch in ('"', "'"):
            return self._parse_quoted_string(ch)
        if context == "array":
            return self._parse_array_quoteless_or_inline()
        if context == "object":
            return self._parse_object_quoteless_inline_safe(braced=True)
        if context == "object_rootless":
            return self._parse_object_quoteless_inline_safe(braced=False)
        return self._parse_quoteless_value()

    def parse_array(self) -> list[Any]:
        self.pos += 1  # consume '['
        items: list[Any] = []
        while True:
            self._skip_sep_and_comments()
            if self.pos >= self.n:
                raise self._error("Unterminated '[' array")
            if self.src[self.pos] == "]":
                self.pos += 1
                return items
            items.append(self.parse_value(context="array"))

    def parse_object(self, braced: bool = True) -> dict[str, Any]:
        if braced:
            self.pos += 1  # consume '{'
        obj: dict[str, Any] = {}
        ctx_name = "object" if braced else "object_rootless"
        while True:
            self._skip_sep_and_comments()
            if self.pos >= self.n:
                if braced:
                    raise self._error("Unterminated '{' object")
                return obj
            if braced and self.src[self.pos] == "}":
                self.pos += 1
                return obj

            key = self._parse_key()
            self._skip_ws_and_comments(stop_at_newline=False)
            if self.pos >= self.n or self.src[self.pos] != ":":
                raise self._error(f"Expected ':' after key '{key}'")
            self.pos += 1  # consume ':'

            val = self.parse_value(context=ctx_name)
            obj[key] = val

    def parse_root(self) -> Any:
        self._skip_ws_and_comments(stop_at_newline=False)
        if self.pos >= self.n:
            return {}
        ch = self.src[self.pos]
        if ch == "{":
            val = self.parse_object(braced=True)
            self._skip_ws_and_comments(stop_at_newline=False)
            if self.pos < self.n:
                raise self._error(f"Unexpected trailing content: {self.src[self.pos:self.pos+20]!r}")
            return val
        if ch == "[":
            val = self.parse_array()
            self._skip_ws_and_comments(stop_at_newline=False)
            if self.pos < self.n:
                raise self._error(f"Unexpected trailing content: {self.src[self.pos:self.pos+20]!r}")
            return val

        # Rootless HJSON object: `key: value` at top level without outer `{ ... }`
        # Fallback cleanly if valid strict JSON scalar
        return self.parse_object(braced=False)


def parse_hjson(text: str) -> Any:
    """Parse an HJSON string into native Python dicts, lists, and primitives."""
    try:
        # Fast path if standard JSON
        stripped = text.lstrip("\ufeff \t\r\n")
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                pass
        return _HjsonParser(text).parse_root()
    except HjsonDecodeError:
        raise
    except Exception as exc:
        raise HjsonDecodeError(str(exc)) from exc


def load_hjson(file_path: str | Path) -> Any:
    """Load and parse an `.hjson` file from disk (UTF-8)."""
    path = Path(file_path)
    return parse_hjson(path.read_text(encoding="utf-8"))
