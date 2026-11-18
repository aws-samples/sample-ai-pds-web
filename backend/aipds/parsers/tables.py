# backend/aipds/parsers/tables.py
"""Data files (xlsx, csv) → a short profile the agent reads + the full data as UTF-8 CSV.

**Why not one markdown table (the previous path).** A data file was rendered as one markdown
table and cut at 50,000 characters, so a 5,000-row sheet kept ~550 rows and every sheet after a
large one vanished — with no signal to the user. Pasting more rows is not the fix either: the
agent reads its attachments into the context, and a data file is mostly rows it does not need.

So the upload is split by what each part is for:

- **Profile (`<name>.md`)** — the file the attachment mention points at. Per sheet: size, each
  column's type, blanks, distinct values, a summary (range/sum, top values), and a few sample rows.
  A few thousand characters describe the whole file, whatever its row count.
- **Data (`<name>.<sheet>.csv`, or the `.csv` itself)** — every row, UTF-8, comma-separated, first
  row the header. The profile tells the agent to query it with Bash rather than read it whole.
  The agent's sandbox hides the backend venv (infra/scripts/aipds-launch), so pandas is **not**
  available there — the hint names tools that are (`python3` with `csv`, awk, grep).

pandas runs here, once per upload, only to compute the profile.

Reading fixes what the markdown path silently lost: CP949 CSVs (Korean Excel's default "CSV")
decoded as UTF-8 became U+FFFD; formula cells with no cached value became blanks; merged cells
kept the value only in their first cell; number formats (`15%`, `00123`) were dropped; and a stray
formatted cell far from the data padded the table with empty cells until the limit was spent.
"""
from __future__ import annotations

import codecs
import csv
import datetime as dt
import io
import re
import zipfile
from dataclasses import dataclass, field

#: Sample rows shown per sheet, and the column/character caps that keep a wide sheet's profile short.
SAMPLE_ROWS = 5
PROFILE_COLUMNS = 60
SAMPLE_COLUMNS = 20
_CLIP = 60


def _cell(text: str) -> str:
    # Line breaks and pipes inside a cell break the markdown table.
    return " ".join(text.split()).replace("|", "\\|")


def md_table(rows: list[list[str]]) -> str:
    width = max(len(row) for row in rows)
    rows = [[_cell(c) for c in row] + [""] * (width - len(row)) for row in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(row) + " |" for row in rows[1:]]
    return "\n".join(lines)


@dataclass
class Sheet:
    title: str
    #: Trimmed grid (no empty rows, no empty leading/trailing columns). Row 0 is the header.
    rows: list[list[object]]
    hidden: bool = False
    #: Merged ranges whose value was copied into every cell of the range.
    merged: int = 0
    #: Formula cells with no cached value — kept as the formula text, since nothing here computes it.
    formulas: int = 0
    notes: list[str] = field(default_factory=list)


# ---- values ----------------------------------------------------------------------------------

def _num(v: float | int) -> float | int:
    """0.1+0.2 → 0.3: binary noise beyond 15 significant digits is not data."""
    if isinstance(v, int):
        return v
    v = float(f"{v:.15g}")
    return int(v) if v.is_integer() and abs(v) < 1e15 else v


def _xlsx_value(cell) -> object:
    v = cell.value
    if v is None:
        return None
    if isinstance(v, str):
        return v if v.strip() else None
    if isinstance(v, bool):
        return v
    if isinstance(v, dt.datetime):
        return v.date() if v.time() == dt.time() else v
    if isinstance(v, (int, float)):
        fmt = (cell.number_format or "General").split(";")[0]
        # Keep what the sheet shows where the raw number means something else: a percentage, or a
        # code padded with zeros (00123 is not the number 123).
        if "%" in fmt:
            return f"{_num(v * 100)}%"
        if re.fullmatch(r"0{2,}", fmt) and float(v).is_integer():
            return str(int(v)).zfill(len(fmt))
        return _num(v)
    return v


def _text(v: object) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, dt.datetime):
        return v.isoformat(sep=" ", timespec="seconds")
    if isinstance(v, (dt.date, dt.time)):
        return v.isoformat()
    return str(v)


def _trim(grid: list[list]) -> list[list[object]]:
    rows = [row for row in grid if any(v is not None for v in row)]
    if not rows:
        return []
    used = [i for row in rows for i, v in enumerate(row) if v is not None]
    lo, hi = min(used), max(used) + 1
    return [(row + [None] * (hi - len(row)))[lo:hi] for row in rows]


# ---- reading ---------------------------------------------------------------------------------

#: Optional namespace prefix — a sheet may be written as `<x:c>` rather than `<c>`.
_P = rb"(?:\w+:)?"
#: A formula cell with no cached value: `<f>…</f>` (or a shared `<f …/>`) followed by no `<v>`, or
#: an empty one, before the cell closes. Excel always writes the value; scripts often do not.
_UNCACHED_FORMULA = re.compile(
    rb"(?:</" + _P + rb"f>|<" + _P + rb"f\b[^>]*/>)\s*"
    rb"(?:<" + _P + rb"v\s*/>|<" + _P + rb"v>\s*</" + _P + rb"v>)?\s*</" + _P + rb"c>")
_MERGE_CELL = re.compile(rb"<" + _P + rb"mergeCell\b[^>]*\bref=\"([A-Z]+\d+:[A-Z]+\d+)\"")


def _scan_sheet(z: zipfile.ZipFile, path: str) -> tuple[bool, list[tuple[int, int, int, int]]]:
    """(has a formula with no cached value, merged ranges as 1-based (min_col, min_row, max_col, max_row)).

    Read-only openpyxl exposes neither, and loading the full workbook to get them costs far more
    memory than a 10MB upload deserves. An XML parser is no cheaper here: iterparse keeps every
    element it is not asked about, so a million-cell sheet grew the process past 1GB. The raw XML
    is scanned in chunks instead — both patterns are short and fixed.
    """
    from openpyxl.utils.cell import range_boundaries
    uncached = False
    refs: set[bytes] = set()
    try:
        with z.open(path.lstrip("/")) as src:
            tail = b""
            while chunk := src.read(1 << 20):
                window = tail + chunk
                uncached = uncached or bool(_UNCACHED_FORMULA.search(window))
                refs.update(_MERGE_CELL.findall(window))
                tail = chunk[-512:]
    except KeyError:
        return False, []
    return uncached, [range_boundaries(ref.decode()) for ref in sorted(refs)]


def read_xlsx(data: bytes) -> list[Sheet]:
    from openpyxl import load_workbook
    values = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    # Formula text comes from a second workbook (`data_only=False`), read only for sheets that
    # need it: `data_only` gives the value Excel cached at save time, and a file written by a
    # script has none — the cell would read as blank. Parsing is most of the cost, so a sheet
    # whose formulas all carry values is not parsed twice.
    formulas = None
    sheets: list[Sheet] = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for index, ws in enumerate(values.worksheets):
            # Without this, rows are padded to the sheet's declared dimension — a formatted cell
            # at XFD1048576 turns every row into 16,384 cells.
            ws.reset_dimensions()
            frows = None
            uncached, merges = _scan_sheet(z, ws._worksheet_path)
            if uncached:
                if formulas is None:
                    formulas = load_workbook(io.BytesIO(data), read_only=True, data_only=False)
                wf = formulas.worksheets[index]
                wf.reset_dimensions()
                frows = wf.iter_rows(values_only=True)
            grid: list[list[object]] = []
            pending = 0
            for vrow in ws.iter_rows():
                row = [_xlsx_value(cell) for cell in vrow]
                if frows is not None:
                    for i, f in enumerate(next(frows, ())):
                        if i < len(row) and row[i] is None and isinstance(f, str) \
                                and f.startswith("="):
                            row[i] = f
                            pending += 1
                grid.append(row)
            merged = 0
            for c1, r1, c2, r2 in merges:
                if r1 > len(grid) or c1 > len(grid[r1 - 1]):
                    continue
                top = grid[r1 - 1][c1 - 1]
                if top is None:
                    continue
                for r in range(r1, r2 + 1):
                    while len(grid) < r:
                        grid.append([])
                    row = grid[r - 1]
                    row.extend([None] * (c2 - len(row)))
                    for c in range(c1, c2 + 1):
                        row[c - 1] = top
                merged += 1
            rows = _trim(grid)
            if rows:
                sheets.append(Sheet(ws.title, rows, hidden=ws.sheet_state != "visible",
                                    merged=merged, formulas=pending))
    return sheets


def _decode(data: bytes) -> tuple[str, str]:
    """Bytes → (text, encoding). Korean Excel saves "CSV" as CP949, not UTF-8."""
    if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return data.decode("utf-16"), "UTF-16"
    for encoding, label in (("utf-8-sig", "UTF-8"), ("cp949", "CP949")):
        try:
            return data.decode(encoding), label
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace"), "UTF-8 (일부 글자 깨짐)"


def read_csv(data: bytes, title: str) -> Sheet:
    text, encoding = _decode(data)
    try:
        dialect = csv.Sniffer().sniff(text[:20_000], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    grid = [[(v if v.strip() else None) for v in row]
            for row in csv.reader(io.StringIO(text), dialect)]
    sheet = Sheet(title, _trim(grid))
    if encoding != "UTF-8":
        sheet.notes.append(f"원본 인코딩 {encoding} → UTF-8로 변환해 저장했다.")
    if dialect.delimiter != ",":
        sheet.notes.append(f"원본 구분자 {dialect.delimiter!r} → 쉼표로 바꿔 저장했다.")
    return sheet


def to_csv(sheet: Sheet) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    for row in sheet.rows:
        writer.writerow([_text(v) for v in row])
    return out.getvalue()


# ---- profile ---------------------------------------------------------------------------------

_NUMERIC_TEXT = re.compile(r"[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?")
_DATE_TEXT = re.compile(r"\d{4}[-./]\d{1,2}[-./]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?")


def _header(row: list[object]) -> list[str]:
    names: list[str] = []
    for i, v in enumerate(row):
        name = " ".join(_text(v).split()) or f"(열{i + 1})"
        base, n = name, 2
        while name in names:
            name, n = f"{base}_{n}", n + 1
        names.append(name)
    return names


def _fmt(v: float) -> str:
    v = _num(v)
    return f"{v:,}" if isinstance(v, int) else f"{v:,.4g}" if abs(v) < 1e6 else f"{v:,.0f}"


def _clip(s: str) -> str:
    s = " ".join(s.split())
    return s if len(s) <= _CLIP else s[:_CLIP - 1] + "…"


def _column(series) -> tuple[str, str]:
    """(type label, summary) for one column."""
    import pandas as pd
    values = series.dropna()
    if values.empty:
        return "빈 열", ""
    if values.map(lambda v: isinstance(v, (dt.date, dt.datetime))).all():
        return "날짜", f"{_text(values.min())} ~ {_text(values.max())}"
    texts = values.map(_text)
    # A leading zero (00123) makes it a code — summing or averaging it means nothing.
    is_code = texts.str.fullmatch(r"0\d+").any()
    if not is_code and (
            texts.str.fullmatch(_NUMERIC_TEXT.pattern).mean() >= 0.95
            or values.map(lambda v: isinstance(v, (int, float))
                          and not isinstance(v, bool)).all()):
        nums = pd.to_numeric(texts.str.replace(",", "").str.rstrip("%"), errors="coerce").dropna()
        if not nums.empty:
            # A sum of percentages is not a quantity, so a percentage column shows no sum.
            if texts.str.endswith("%").mean() >= 0.95:
                return "숫자(%)", (f"최소 {_fmt(nums.min())}% · 평균 {_fmt(nums.mean())}% · "
                                  f"최대 {_fmt(nums.max())}%")
            return "숫자", (f"최소 {_fmt(nums.min())} · 평균 {_fmt(nums.mean())} · "
                          f"최대 {_fmt(nums.max())} · 합계 {_fmt(nums.sum())}")
    if texts.str.fullmatch(_DATE_TEXT.pattern).mean() >= 0.95:
        parsed = pd.to_datetime(texts, errors="coerce", format="mixed").dropna()
        if not parsed.empty:
            return "날짜", f"{parsed.min():%Y-%m-%d} ~ {parsed.max():%Y-%m-%d}"
    counts = texts.value_counts()
    if len(counts) <= 20 or len(counts) <= len(texts) * 0.5:
        top = ", ".join(f"{_clip(k)}({n:,})" for k, n in counts.head(5).items())
        more = f" 외 {len(counts) - 5:,}종" if len(counts) > 5 else ""
        return "범주", top + more
    return "텍스트", f"평균 {texts.str.len().mean():.0f}자 · 예: {_clip(texts.iloc[0])}"


def profile_sheet(sheet: Sheet, data_path: str) -> str:
    import pandas as pd
    if len(sheet.rows) == 1:
        # One row (a label and a total, say) is not a table with a header — show it as is.
        return "\n".join([f"## 시트: {sheet.title}" + (" (숨김 시트)" if sheet.hidden else ""), "",
                          f"- 전체 데이터: `{data_path}`",
                          "- 한 행뿐이다: " + " · ".join(_clip(_text(v)) for v in sheet.rows[0])])
    header = _header(sheet.rows[0])
    body = [row + [None] * (len(header) - len(row)) for row in sheet.rows[1:]]
    df = pd.DataFrame(body, columns=header, dtype=object)
    title = f"## 시트: {sheet.title}" + (" (숨김 시트)" if sheet.hidden else "")
    lines = [title, "",
             f"- 크기: 데이터 {len(df):,}행 × {len(header):,}열 (첫 행을 헤더로 봤다)",
             f"- 전체 데이터: `{data_path}`"]
    if sheet.merged:
        lines.append(f"- 병합 셀 {sheet.merged:,}곳은 범위 안의 모든 칸에 같은 값을 채웠다.")
    if sheet.formulas:
        lines.append(f"- 수식 {sheet.formulas:,}개는 저장된 계산값이 없어 수식 그대로 남겼다"
                     " (Excel에서 열어 저장하지 않은 파일).")
    lines += [f"- {note}" for note in sheet.notes]
    stats = [["열", "타입", "빈 값", "고유값", "요약"]]
    for name in header[:PROFILE_COLUMNS]:
        kind, summary = _column(df[name])
        col = df[name]
        stats.append([name, kind, f"{int(col.isna().sum()):,}",
                      f"{int(col.dropna().map(_text).nunique()):,}", summary])
    lines += ["", md_table(stats)]
    if len(header) > PROFILE_COLUMNS:
        lines.append(f"\n나머지 {len(header) - PROFILE_COLUMNS:,}열: "
                     + ", ".join(header[PROFILE_COLUMNS:]))
    if len(df):
        shown = header[:SAMPLE_COLUMNS]
        sample = [shown] + [[_clip(_text(v)) for v in row[:SAMPLE_COLUMNS]]
                            for row in body[:SAMPLE_ROWS]]
        caption = f"\n처음 {min(len(df), SAMPLE_ROWS)}행"
        if len(header) > SAMPLE_COLUMNS:
            caption += f" (앞 {SAMPLE_COLUMNS}열만)"
        lines += [caption + ":", "", md_table(sample)]
    return "\n".join(lines)


def profile(filename: str, original_path: str,
            sheets: list[tuple[Sheet, str]]) -> str:
    """The whole file's profile. `sheets` pairs each sheet with the path of its CSV."""
    total = sum(len(s.rows) - 1 for s, _ in sheets)
    head = [
        f"# 데이터 파일 요약: {filename}",
        "",
        f"원본: `{original_path}` · 시트 {len(sheets):,}개 · 데이터 {total:,}행",
        "",
        "> 이 문서는 요약이다. 전체 행은 시트별 CSV(UTF-8, 쉼표 구분, 첫 행이 헤더)에 있다. "
        "CSV를 Read로 통째로 읽지 말 것 — 필요한 값만 Bash로 조회한다: `head`, `grep`, "
        "`awk -F,`, 또는 `python3 -c 'import csv; ...'` (pandas는 설치되어 있지 않다).",
    ]
    if not sheets:
        return "\n".join(head + ["", "데이터가 있는 시트가 없다."])
    return "\n\n".join(["\n".join(head)] + [profile_sheet(s, p) for s, p in sheets])
