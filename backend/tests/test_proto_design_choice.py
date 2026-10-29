"""The design-context answer decides whether the admin brand profile applies (proto/design_choice.py)."""
from aipds.proto import layout
from aipds.proto.design_choice import brand_choice, brand_opted_in, effective_profile
from fakes.in_memory_s3 import FakeS3Store

_KO_TEMPLATE = """# 프로토타입 디자인 컨텍스트

## Question 1
이 프로토타입은 어떤 모습이어야 합니까?

A) 깔끔하고 현대적인 기본 디자인
B) 우리 조직의 브랜드에 맞춘다 — 브랜드 가이드, 색상, 로고 또는 참고 자료를 제공하겠습니다
C) 사용자가 이미 쓰는 제품이나 도구와 비슷한 느낌으로 만든다
D) 최소한 — 외관이 아니라 기능에만 집중한다
X) 기타 (아래 [Answer]: 태그 뒤에 직접 설명해 주세요)

[Answer]: {answer}

## Question 2
위에서 B 또는 C를 고르신 경우에만 답해 주세요.

A) 사내 시스템과 비슷한 느낌
D) 브랜드 가이드나 참고 URL을 직접 제공하겠습니다
X) 기타

[Answer]:
"""

_EN_TEMPLATE = """# Prototype Design Context

## Question 1
What should this prototype look like?

A) Clean and modern — use a professional default design
B) Match my organization's brand — I will provide brand guidelines
C) Match a specific product or tool our users already use
D) Minimal — focus on functionality, not appearance
X) Other (please describe after [Answer]: tag below)

[Answer]: {answer}
"""


def test_brand_option_chosen_is_true():
    assert brand_choice(_KO_TEMPLATE.format(answer="B")) is True
    assert brand_choice(_EN_TEMPLATE.format(answer="B) Match my organization's brand")) is True


def test_other_lettered_options_are_false():
    """Answering A (or C, D) must keep the brand out."""
    for letter in ("A", "C", "D", "a"):
        assert brand_choice(_KO_TEMPLATE.format(answer=letter)) is False


def test_brand_word_in_a_later_question_does_not_count():
    """Question 2's option D mentions a brand guide, but only Question 1 is the appearance choice."""
    assert brand_choice(_KO_TEMPLATE.format(answer="A")) is False


def test_unreadable_answers_are_none():
    # Unanswered, free text (X), prose that only starts with a capital, or an unknown letter.
    for answer in ("", "X: 회사 CI 색상으로", "Brand colours please", "E"):
        assert brand_choice(_KO_TEMPLATE.format(answer=answer)) is None


def test_question_one_without_a_brand_option_is_none():
    md = "## Question 1\nWhat device?\n\nA) Desktop\nB) Mobile\n\n[Answer]: B\n"
    assert brand_choice(md) is None


def test_reordered_options_follow_the_text_not_the_letter():
    md = ("## Question 1\nLook?\n\nA) Match my organization's brand\n"
          "B) Clean and modern\n\n[Answer]: B\n")
    assert brand_choice(md) is False


async def test_missing_file_is_none():
    assert await brand_opted_in(FakeS3Store(), "prototype") is None


async def test_reads_the_path_a1_location():
    s3 = FakeS3Store()
    s3.blobs[layout.design_context_key("prototype")] = _KO_TEMPLATE.format(answer="A")
    assert layout.design_context_key("prototype") == (
        "aiplc-docs/discovery/prototype/design-context.md")
    assert await brand_opted_in(s3, "prototype") is False


async def test_effective_profile_drops_the_profile_only_on_a_non_brand_answer():
    profile = object()
    s3 = FakeS3Store()
    assert await effective_profile(profile, s3, "prototype") is profile  # unknown → unchanged
    assert await effective_profile(None, s3, "prototype") is None

    s3.blobs[layout.design_context_key("prototype")] = _KO_TEMPLATE.format(answer="B")
    assert await effective_profile(profile, s3, "prototype") is profile

    s3.blobs[layout.design_context_key("prototype")] = _KO_TEMPLATE.format(answer="A")
    assert await effective_profile(profile, s3, "prototype") is None


async def test_a_broken_store_is_none():
    class _Boom:
        async def get(self, key):
            raise RuntimeError("s3 unreachable")

    assert await brand_opted_in(_Boom(), "prototype") is None
