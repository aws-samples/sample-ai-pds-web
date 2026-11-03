# AI-PDS Web 개발 가이드

**한국어** | [English](DEVELOPMENT.md)

로컬 실행, 환경 변수, 테스트, 화면 접근 권한이 어떻게 지켜지는지를 다룬다. AI-PDS가 무엇이고 어떻게
배포하는지는 [README](README.ko.md)를 보라.

## 화면과 접근 권한

프론트 미들웨어는 UX 게이트일 뿐이고 **보안 경계는 백엔드의 `require_admin`·`require_user`·
`require_project_access`다.** 공개 경로 목록은 양쪽(`frontend/lib/auth/gate.ts`,
`backend/tests/test_auth_route_coverage.py`)이 짝으로 단정한다.

프로젝트에는 소유자 한 명과 열람 멤버가 있다. 소유자와 관리자는 읽고 바꾸고, 멤버는 읽기만 하며, 그 밖의
사용자에게는 없는 프로젝트와 같은 404다(`backend/aipds/project_access.py`). 아래 표의 *프로젝트* 접근이
이것이다.

| 화면 | 하는 일 | 접근 |
|---|---|---|
| `/` | 소유하거나 열람하는 프로젝트(관리자는 전부)의 목록·생성·내보내기·가져오기 | 로그인 |
| `/projects/{id}/workspace` | Discovery 대화 — 실시간 턴, 질문 시트, 첨부, 생성 문서 드로어 | 프로젝트 |
| `/projects/{id}/dashboard` | 스테이지 진행·산출물·활동 | 프로젝트 |
| `/projects/{id}/review` | 문서 리뷰와 승인 게이트 | 프로젝트 |
| `/projects/{id}/questions` | 질문 파일 하나를 펼쳐 답하는 화면 | 프로젝트 |
| `/projects/{id}/prototypes` | 빌드 세션·호스팅·검증 설문 | 프로젝트 |
| `/projects/{id}/handoff` | AI-DLC 인계 — 준비 상태, 보완 질문, AI 제안 확인, 패키지(vision 문서·결정 장부·시작 프롬프트)와 zip | 프로젝트 |
| `/survey/{token}` | 익명 검증 설문 | **공개**(토큰) |
| `/api/proto/{pid}/{slug}` | 빌드된 프로토타입. **프리뷰 도메인(`AipdsPreviewStack`)에서만** 서빙된다. 공유 링크가 접근 쿠키를 심고, 쿠키가 없으면 404가 정답이다 | **공개**(토큰 쿠키) |
| `/admin/users` · `/admin/models` · `/admin/design` | 사용자·역할, 모델 카탈로그, 브랜드 디자인 프로필 | admin |
| `/manual` | 매뉴얼. 계정을 받기 전에 무엇을 하는 도구인지 읽을 수 있도록 로그인 앞에 있다 | **공개** |

## 로컬에서 띄우기

프론트(:3000) → 백엔드(:8000) → 에이전트가 Bedrock을 부른다. 버킷과 롤은 필요하므로
`AipdsDrillStack`을 먼저 배포한다. Python **3.11**, Node.js 20+.

```bash
git submodule update --init --recursive
cd backend && python3.11 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cd ../frontend && npm install
cp ../backend/.env.example ../backend/.env           # DrillStack 출력값으로 채운다

cd backend && .venv/bin/python -m uvicorn aipds.app:app --host 127.0.0.1 --port 8000 --reload
cd frontend && npm run dev                           # http://localhost:3000
```

로컬에서는 에이전트가 내 사용자로 직접 돈다 — 샌드박스는 인스턴스의 기능이다. 인증을 끈 백엔드는 모든 요청을 admin으로 받으므로 `127.0.0.1`에만 연다.

| 변수 | 넣을 값 |
|---|---|
| `AIPDS_S3_BUCKET` / `AIPDS_S3_REGION` | `AipdsDrillStack.ArtifactsBucketName`과 그 리전. 비우면 조용히 로컬 전용으로 돈다 |
| `AIPDS_DISCOVERY_CONFIG_DIR` / `AIPDS_PROTO_CONFIG_DIR` | 리포의 `discovery-config/`·`proto-config/` 절대 경로. 비우면 에이전트가 **내 `~/.claude`**를 읽어 개인 스킬이 결과에 섞인다 |
| `ANTHROPIC_MODEL` | 프로젝트에 모델이 없을 때 쓰는 대체 Bedrock 추론 프로파일 id |
| `AIPDS_COGNITO_USER_POOL_ID` / `AIPDS_COGNITO_CLIENT_ID` | **둘 다** 비우고 `AIPDS_AUTH_DISABLED=1`을 주면 인증을 건너뛴다(`.env.example`의 로컬 기본). 그 스위치 없이 둘 다 비거나 하나만 채우면 백엔드가 뜨지 않는다 |
| `AIPDS_PUBLIC_PATH_PREFIX` | 브라우저가 :8000의 백엔드를 직접 부를 때 `""` |

나머지 변수 전부와, 배포가 쓰는 값과 그 이유는 [`infra/lib/user-data.ts`](infra/lib/user-data.ts)의
systemd 유닛에 주석으로 있다. 기본값은 그 값을 읽는 코드(`backend/aipds/app.py`,
`backend/aipds/cli_settings.py`)에 있다.

**브라우저가 원격이면**(`localhost`가 아니라 프록시 호스트명으로 접속하면) `localhost:8000` 호출이
브라우저 자신의 컴퓨터로 간다. `frontend/.env.local`에 `NEXT_PUBLIC_API_BASE_URL=/api`를 넣어 Next
라우트 핸들러가 백엔드(`AIPDS_BACKEND_URL`, 기본 `http://localhost:8000`)로 프록시하게 하고,
`next.config.mjs`의 `allowedDevOrigins`에 그 호스트명을 더한다.

## 테스트

```bash
cd backend && .venv/bin/python -m pytest -q     # 백엔드 유닛 (AWS 불필요)
cd frontend && npm test                         # 프론트 유닛 (Vitest + MSW)
cd infra && npm test                            # 합성 + 템플릿 단정 (배포 없이)
cd frontend && npm run test:e2e                 # e2e (실 백엔드와 Bedrock 필요)
```

| 이것을 돌린다 | 이것을 고쳤을 때 |
|---|---|
| `npm test -- noHardcodedKorean` | 화면 문구 — 딕셔너리를 거치지 않은 한국어 리터럴을 잡는다 |
| `npm test -- parity` | 매뉴얼 — ko/en의 구조·앵커가 어긋난 것을 잡는다 |
| `pytest -q -k sdk_available` | `claude-agent-sdk` 버전 — 옵션 필드와 번들 바이너리를 확인한다 |
| `pytest -q -k no_legacy_brand` | 제품 이름이 들어가는 모든 것 |
| `pytest -q -k no_hardcoded_secrets` | 이름에 token·secret·password가 든 문자열 — 보안심사의 Bandit이 잡는 것(B105/B106/B107)을 미리 잡는다 |
| `pytest -q -k synthetic_email_domains` | 예시 이메일 주소 — 예약 도메인(`example.com`, `.test` 등)만 |
