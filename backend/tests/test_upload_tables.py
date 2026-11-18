"""Data-file uploads (xlsx, csv): a profile the agent reads, plus the full rows as CSV.

Each case is a way the earlier single-markdown-table path lost data without saying so.
"""
import csv
import datetime as dt
import io
import re
from pathlib import Path

import pytest
from openpyxl import Workbook

from aipds.agent.prompts import DATA_FILE_EXTS, answer_attachments
from aipds.parsers.uploads import DATA_EXTS, MAX_CHARS, prepare


def _xlsx(build) -> bytes:
    wb = Workbook()
    build(wb)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _rows(text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text)))


def _sheet_csv(up, sheet: str) -> list[list[str]]:
    return _rows(dict(up.extras)[f"{up.original_key}.{sheet}.csv"])


def test_every_row_and_every_sheet_is_kept_and_the_profile_stays_short():
    """5,000 rows used to be cut to ~550, and a sheet after a large one disappeared."""
    def build(wb):
        ws = wb.active
        ws.title = "매출"
        ws.append(["부서", "금액"])
        for r in range(5000):
            ws.append([["영업", "개발", "인사"][r % 3], r * 10])
        wb.create_sheet("요약").append(["합계", 124_975_000])
    up = prepare("매출.xlsx", _xlsx(build))
    assert len(_sheet_csv(up, "매출")) == 5001
    assert _sheet_csv(up, "요약") == [["합계", "124975000"]]
    assert up.truncated is False and len(up.text) < 5_000
    assert "## 시트: 요약" in up.text
    assert "데이터 5,000행 × 2열" in up.text
    assert "합계 124,975,000" in up.text            # the numeric column's summary
    assert "영업(1,667)" in up.text                  # the categorical column's top values


def test_a_cp949_csv_is_read_as_korean_and_stored_as_utf8():
    """Korean Excel saves "CSV" as CP949; decoded as UTF-8 every Hangul character became U+FFFD."""
    up = prepare("고객.csv", "이름,부서\n홍길동,영업\n".encode("cp949"))
    assert up.original.decode("utf-8") == "이름,부서\n홍길동,영업\n"
    assert "�" not in up.text and "CP949" in up.text
    assert up.extras == ()          # the CSV itself is the data — no second copy


def test_a_semicolon_csv_is_stored_comma_separated():
    up = prepare("a.csv", "a;b\n1;2\n3;4\n".encode())
    assert _rows(up.original.decode()) == [["a", "b"], ["1", "2"], ["3", "4"]]


def test_a_formula_with_no_cached_value_keeps_its_formula():
    """A file written by a script has no cached result; `data_only` read it as blank."""
    def build(wb):
        ws = wb.active
        ws.append(["a", "b", "sum"])
        ws.append([1, 2, "=A2+B2"])
    up = prepare("f.xlsx", _xlsx(build))
    assert _sheet_csv(up, "Sheet")[1] == ["1", "2", "=A2+B2"]
    assert "수식 1개" in up.text


def test_a_merged_cell_fills_its_whole_range():
    def build(wb):
        ws = wb.active
        ws.append(["구분", "항목"])
        ws.append(["A", "x"])
        ws.append([None, "y"])
        ws.merge_cells("A2:A3")
    up = prepare("m.xlsx", _xlsx(build))
    assert _sheet_csv(up, "Sheet")[1:] == [["A", "x"], ["A", "y"]]
    assert "병합 셀 1곳" in up.text


def test_number_formats_that_change_meaning_are_kept():
    def build(wb):
        ws = wb.active
        ws.append(["pct", "date", "code", "f"])
        ws.append([0.15, dt.datetime(2026, 1, 5), 123, 0.1 + 0.2])
        ws["A2"].number_format = "0%"
        ws["C2"].number_format = "00000"
    up = prepare("n.xlsx", _xlsx(build))
    assert _sheet_csv(up, "Sheet")[1] == ["15%", "2026-01-05", "00123", "0.3"]
    # A zero-padded code is not summed, and a percentage column shows no sum.
    assert re.search(r"\| code \| 범주 \|", up.text)
    assert re.search(r"\| pct \| 숫자\(%\) \|[^\n]*최대 15%\s*\|", up.text)


def test_a_stray_cell_far_from_the_data_does_not_pad_the_grid():
    """A whitespace cell at Z3000 padded the table with empty cells until the 50,000-char limit."""
    def build(wb):
        ws = wb.active
        ws.append(["a", "b"])
        ws.append([1, 2])
        ws["Z3000"] = " "
    up = prepare("s.xlsx", _xlsx(build))
    assert _sheet_csv(up, "Sheet") == [["a", "b"], ["1", "2"]]
    assert len(up.text) < 2_000


def test_a_one_row_sheet_is_shown_as_is_and_hidden_sheets_are_marked():
    def build(wb):
        wb.active.append(["total", 999])
        wb.active.sheet_state = "hidden"
        wb.create_sheet("visible").append(["x"])
    up = prepare("h.xlsx", _xlsx(build))
    assert "## 시트: Sheet (숨김 시트)" in up.text
    assert "한 행뿐이다: total · 999" in up.text


def test_sheet_names_that_collide_after_sanitising_get_distinct_csvs():
    def build(wb):
        wb.active.title = "a b"
        wb.active.append(["1"])
        wb.create_sheet("a-b").append(["2"])
    up = prepare("c.xlsx", _xlsx(build))
    keys = [k for k, _ in up.extras]
    assert keys == [f"{up.original_key}.a-b.csv", f"{up.original_key}.a-b-2.csv"]


def test_the_profile_tells_the_agent_to_query_the_csv_rather_than_read_it():
    up = prepare("a.csv", b"a,b\n1,2\n")
    assert "통째로 읽지 말 것" in up.text and "pandas는 설치되어 있지 않다" in up.text


def test_a_wide_sheet_profiles_its_first_columns_and_names_the_rest():
    def build(wb):
        wb.active.append([f"c{i}" for i in range(100)])
        wb.active.append(list(range(100)))
    up = prepare("w.xlsx", _xlsx(build))
    assert "나머지 40열: c60" in up.text
    assert len(up.text) < MAX_CHARS


def test_a_corrupt_xlsx_is_a_value_error():
    with pytest.raises(ValueError):
        prepare("bad.xlsx", b"not a real xlsx")


def test_an_empty_csv_is_a_file_with_no_sheets():
    assert "데이터가 있는 시트가 없다" in prepare("empty.csv", b"").text


# ---- what the agent is told ----

def test_answer_attachments_tell_the_agent_a_data_file_is_a_profile():
    ko = answer_attachments("ko", [("uploads/ab12cd34/매출.xlsx.md", "uploads/ab12cd34/매출.xlsx")])
    assert "데이터 파일의 요약" in ko and "통째로 읽지 말 것" in ko
    assert "도표" not in ko                       # that wording is a PDF's
    en = answer_attachments("en", [("uploads/ab12cd34/a.csv.md", "uploads/ab12cd34/a.csv")])
    assert "profile of the data file" in en and "do not read a CSV whole" in en
    pdf = answer_attachments("ko", [("uploads/ab12cd34/a.pdf.md", "uploads/ab12cd34/a.pdf")])
    assert "도표" in pdf and "요약" not in pdf


_REPO = Path(__file__).resolve().parents[2]


def test_every_copy_of_the_data_extensions_matches():
    """Three places tell a data file from a document: the parser, the answers prompt, and the
    chat mention (workspace/page.tsx). One left behind sends the agent the PDF wording."""
    assert set(DATA_FILE_EXTS) == set(DATA_EXTS)
    page = (_REPO / "frontend/app/projects/[projectId]/workspace/page.tsx").read_text("utf-8")
    m = re.search(r"const DATA_FILE = /\\\.\(([a-z|]+)\)\$/i;", page)
    assert m and {f".{e}" for e in m.group(1).split("|")} == set(DATA_EXTS)
