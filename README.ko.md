# AI-Driven Product Discovery and Strategy (AI-PDS)
## AI-driven product life cycle (AI-PLC)의 웹 애플리케이션 구현

**한국어** | [English](README.md)

> **IMPORTANT**
> 생성형 AI는 틀릴 수 있습니다. 선택한 AI 모델과 에이전틱 코딩 도구가 만들어낸 결과물과
> 비용은 모두 직접 검토하시기 바랍니다. [AWS Responsible AI
> Policy](https://aws.amazon.com/ai/responsible-ai/policy/)를 참고하세요.

> **Note:** 이 리포지토리의 예제는 **실험·교육 목적**입니다. 개념과 기법을 보여주기 위한
> 것이며, 프로덕션 환경에 그대로 쓰기 위한 것이 아닙니다.
>
> This is sample code, for non-production usage. You should work with your security and legal teams
> to meet your organizational security, regulatory and compliance requirements before deployment.

AI-PDS(AI-Driven Product Discovery and Strategy)는 비개발 비즈니스 리더 — PM, 제품 담당 VP,
인접 사업을 탐색하는 CTO — 가 엔지니어링 리소스를 투입하기 전에 AI 유스케이스를 발굴하고,
우선순위를 정하고, 프로토타입으로 만들어 보도록 돕는 역량 중심(capabilities-first) 프레임워크다.
고객 발굴부터 시장 출시까지 모든 단계를 AI가 이끌고, 각 게이트의 결정 권한은 사람에게 남는다.

이 리포는 그 **웹** 구현이다. AI-PLC Discovery 워크플로를 브라우저에서 대화로 진행하며, 참여자
PC에 설치할 것이 없다. 다른 구현은 [지원하는 구현](#지원하는-구현)을 보라.

### 무엇을 하는가

| 역량 | 하는 일 | 결과물 |
|---|---|---|
| Envision | 페인포인트 분석 + PR/FAQ(Working Backwards) | PR/FAQ 문서 |
| Use Case Intake | N개 유스케이스를 문서화·분류 | 유스케이스 저장소 |
| Prioritize | 이중 점수화(Agentic vs Application) | 순위가 매겨진 백로그 |
| Prototype | 명세를 만들고, 프로토타입과 검증 설문까지 빌드·호스팅 | `PROTOTYPE-*.md` 파일, 실행되는 프로토타입, 설문 결과 |
| Product Strategy | 포지셔닝, 비즈니스 모델, KPI | 전략 문서 |
| Go-to-Market | 세분화, 영업 모션, 출시 | GTM 계획 |

**진입점은 세 가지:** 페인포인트, 유스케이스, 기존 프로토타입 명세 중 어디서든 시작한다.
**모든 단계가 종료 지점:** 필요한 것을 얻었으면 거기서 멈춘다.

### 지원하는 구현

| 구현 | 리포지토리 |
|---|---|
| **웹 애플리케이션** (이 리포) | [aws-samples/sample-ai-pds-web](https://github.com/aws-samples/sample-ai-pds-web) |
| **데스크톱 어시스턴트** — Amazon Quick Desktop, Claude Desktop | [aws-samples/sample-ai-pds-desktop](https://github.com/aws-samples/sample-ai-pds-desktop) |
| **Agentic IDE** — Kiro, Claude Code | [aws-samples/sample-ai-plc](https://github.com/aws-samples/sample-ai-plc) |

`PROTOTYPE-*.md` 파일은 모든 구현에서 같은 형식이다. 여기서 만든 명세를 Kiro, Claude Code, 데스크톱
어시스턴트로 넘겨 빌드할 수 있고, 그쪽에서 만든 명세로 여기서 프로젝트를 시작할 수도 있다(진입점 3).

### 웹 구현의 동작 방식

Claude Agent SDK 에이전트가 Discovery 방법론을 구동하고, 프론트엔드가 그 턴을 SSE로 실시간
렌더한다. Discovery가 만든 프로토타입 명세는 같은 화면에서 실물 앱으로 빌드·호스팅되고, 로그인
없이 열리는 링크로 공유하는 검증 설문까지 이어진다. Discovery가 정한 것은 AI-DLC용 인계 패키지 —
vision 문서와 그 뒤의 결정들 — 로 넘어간다. 화면과 생성물 모두 한국어·영어를 지원하고,
관리자는 사용자·모델 카탈로그·브랜드 디자인 프로필을 같은 앱에서 관리한다.

```
frontend/          Next.js 15 (App Router) — 대시보드 · 워크스페이스 · 문서 리뷰 · 프로토타입 · 설문 · 인계 · 관리자 · 매뉴얼
backend/           FastAPI — Discovery 에이전트 · SSE 릴레이 · S3 영속화 · 프로토타입 빌드/호스팅 · 설문 · 인계 패키지 · JWT 검증
infra/             CDK (TypeScript) — 스택 6개, 서울 기본
steering-files/    AI-PLC 룰셋 — aws-samples/sample-ai-plc 서브모듈, 무수정으로 가져온다
discovery-config/  Discovery 에이전트 전용 CLAUDE_CONFIG_DIR
proto-config/      빌드 에이전트 전용 CLAUDE_CONFIG_DIR — 위와 반드시 다른 경로
```

| 찾는 것 | 있는 곳 |
|---|---|
| 화면별 사용법, 관리자 기능, **배포된 환경의 운영과 문제 해결** | 앱의 **`/manual`** (로그인 없이 열린다). 원문: [`frontend/content/manual/`](frontend/content/manual) |
| 로컬 실행, 환경 변수, 테스트, 화면 접근 권한 | [`DEVELOPMENT.ko.md`](DEVELOPMENT.ko.md) |
| 스택이 왜 이렇게 생겼는가 | [`infra/README.ko.md`](infra/README.ko.md) |
| 두 config dir을 왜 나눴는가 | [`discovery-config/README.md`](discovery-config/README.md) |
| 그 밖의 "왜 이렇게 되어 있는가" | 그 파일을 건드린 커밋(`git log`)과 코드 주석 |

---

## AI-PLC 룰셋

Discovery 워크플로는 [aws-samples/sample-ai-plc](https://github.com/aws-samples/sample-ai-plc)의
AI-PLC 룰셋이다 — AI-PDS의 Agentic IDE 구현이며, 다른 구현들도 같은 워크플로를 돌린다. 이 웹
구현은 채팅 기록만으로는 안 되는 것을 더한다: 브라우저 UI, 실시간 턴, 문서 리뷰, 같은 화면에서
프로토타입과 설문까지 빌드·호스팅하는 것.

룰셋은 **여기에 복사해 두지 않는다.** `steering-files/` 서브모듈로 상류의 특정 커밋에 고정해
무수정으로 쓴다 — 사본은 갈라지고, 정본은 상류다. 서브모듈까지 clone한다:

```bash
git clone --recurse-submodules https://github.com/aws-samples/sample-ai-pds-web.git
git submodule update --init --recursive      # 이미 서브모듈 없이 clone했다면
```

`steering-files/`가 비어 있어도 에러는 나지 않는다. 에이전트가 방법론을 따르지 않을 뿐이다.
백엔드가 매 턴 룰셋을 에이전트 워크스페이스로 복사하므로, 서브모듈 포인터를 옮기면
(`git submodule update --remote steering-files` → 커밋·푸시 → `sudo aipds-update`) 다음 턴부터
반영된다. 워크플로 자체의 변경은 상류에서 한다.

---

## 배포

한 번의 `cdk deploy --all`로 로그인할 수 있는 앱이 뜬다. EC2가 이 리포를 clone해 백엔드·프론트를
빌드·기동하고, CloudFront가 그 앞에 붙는다.

**사전 준비:** Node.js 20+, 관리자급 AWS 자격증명(IAM 롤·Cognito·VPC를 만든다), 그리고 Bedrock에서
Claude를 부를 수 있는 계정. 마지막 것은 **Anthropic 첫 사용 양식**을 계정(또는 조직의 관리 계정)에서
한 번 제출하고 Marketplace 결제 수단을 갖춰 두는 것이다. 이것이 없으면 배포는 성공하고 첫 대화가
`AccessDeniedException`으로 실패한다.

```bash
cd infra
npm ci
npx cdk bootstrap aws://<ACCOUNT_ID>/ap-northeast-2        # 계정·리전당 최초 1회
npx cdk deploy --all --require-approval never \
  --parameters AipdsAuthStack:SeedPassword='<임시-비밀번호>'
```

- **15~20분 걸린다.** `cdk deploy`가 끝난 뒤에도 인스턴스가 첫 빌드를 마치는 몇 분 동안 CloudFront가
  502를 줄 수 있다. 손으로 돌릴 것은 없다.
- **배포되는 것은 푸시된 `main`이다.** 인스턴스는 부팅 때 `origin/main`을 clone하고, `cdk deploy`는
  코드를 갱신하지 않는다 — 그것은 `sudo aipds-update`다.
- `AipdsHostingStack.DistributionDomain` 출력값을 **열고**, `admin@aipds.local` 또는 `pm@aipds.local`에
  `SeedPassword` 값으로 **로그인**한다. 30일 동안 유효한 임시 비밀번호이고 각자 첫 로그인에서 바꾼다.
  풀 정책(8자 이상, 대문자·소문자·숫자·기호 각각 하나 이상)을 만족하지 않으면 CloudFormation이 배포
  시작 전에 거부한다.
- **MFA는 꺼져 있다.** 로그인은 비밀번호 하나다. 워크숍 샘플로는 충분하지만 실제 고객 자료에는
  부족하다 — 관리자 비밀번호가 새면 사용자·역할 관리까지 넘어간다. 워크숍 밖에서 쓰려면
  `infra/lib/aipds-auth-stack.ts`에서 MFA를 필수로 켠다(`mfa: cognito.Mfa.REQUIRED`와
  `mfaSecondFactor: { otp: true, sms: false }` — 인증 앱).
- **그 밖에도 프로덕션이 아니라 워크숍에 맞춘 설정이 있다.** 각 줄에 바꿀 설정을 적은 경고 주석이 있다.
  - Cognito에 위협 방지(유출된 자격증명 탐지, 위험 기반 인증)가 없다 — Plus 등급이 필요하다
    (`aipds-auth-stack.ts`).
  - `cdk destroy`가 사용자 풀과 아티팩트 버킷을 내용째 지운다. 버킷에는 버전 관리와 액세스 로그도
    없다(`aipds-auth-stack.ts`, `aipds-drill-stack.ts`).

다른 리전, 스택 출력값, 코드 갱신, 샌드박스, 내리기, 문제 해결은 **`/manual` → 설치 · 운영 · 문제
해결**에 있다. 스택마다 만드는 것, CloudFront → 인스턴스 구간이 왜 사설 HTTP인지,
`AIPDS_AVAILABILITY_ZONES`가 필요한 리전은 [`infra/README.ko.md`](infra/README.ko.md)에 있다.

---

## 책임 있는 AI

AI-PDS Web은 Amazon Bedrock의 Claude 모델로 제품 문서, 프로토타입, 설문 종합의 초안을 만든다.
만들어지는 모든 것은 사람이 판단할 초안이고, 도구는 그 전제 위에 만들어져 있다.

- **결정은 사람이 한다.** 단계는 사람이 질문지에 답하거나 승인 게이트에서 Discovery 문서를 승인해야
  닫힌다. *★ AI 추천* 표시는 제안일 뿐 기본값이 아니다. 인계 패키지에서 모델이 열린 질문 표에 더하는
  행은 근거를 인용해야 하고 코드가 그 인용이 원문에 있는지 확인하며, AI 제안은 누군가 확인할 때까지
  표시가 남는다.
- **AI가 한 일이 보인다.** 사용자가 입력한 말과 제출한 답은 AI가 아니라 앱이 `audit.md`에 원문 그대로
  실제 시각과 함께 남긴다. 턴마다 실행한 도구와 바뀐 파일, AI의 자체 검증 요약, 답 때문에 문서에서
  바뀐 곳이 화면에 보인다.
- **근거와 가정을 가른다.** 문서는 중요한 미지수를 밝혀야 하고, 가정을 고객 근거로 내세우지 않는다.
  설문 종합은 응답자 페르소나별로 결과를 나누고, 대상 사용자 밖의 응답자는 가설을 검증한 것으로 세지
  않는다. 그래도 설문은 작고 자발적으로 응한 표본이므로, 종합은 개별 응답 CSV와 대조한다.

**감안해야 할 한계**

- 모델의 출력은 틀리거나, 빠지거나, 지어낸 것일 수 있다. 수치·시장 사실·인용은 워크숍 밖으로 내보내기
  전에 확인한다.
- 프로토타입은 아이디어 검증용으로 쓰고 버리는 코드이지 운영 소프트웨어가 아니며, 계정 없이 열리는
  링크로 공유된다. 실제 개인정보나 기밀 데이터를 프로토타입이나 설문에 넣지 않는다.
- 업로드한 자료는 모델로 전달된다. 워크숍에 필요한 것만 올린다. 자격증명으로 보이는 값은 감사 기록에서
  가려지지만, 그 밖에는 걸러지지 않는다.
- Amazon Bedrock Guardrails는 구성되어 있지 않다. 콘텐츠 필터링이 필요한 용도라면 추가한다 — 예를
  들어 Bedrock을 직접 부르는 프로토타입은 Converse 호출에 가드레일을 함께 넘길 수 있다.
- 배포되는 롤은 Claude를 **global** 교차 리전 추론 프로파일로 호출하고, 이 프로파일은 요청을 지원되는
  모든 상용 AWS 리전에서 처리할 수 있다. 저장되는 데이터는 내 계정과 리전에 남는다. 데이터 상주 요건이
  있다면 지리적 프로파일을 쓰고 `infra/lib/backend-permissions.ts`의 Bedrock 권한을 그에 맞게 좁힌다.

[AWS Responsible AI Policy](https://aws.amazon.com/ai/responsible-ai/policy/)를 참고한다.

---

## 라이선스

[MIT-0](LICENSE) (MIT No Attribution) — 저작권 고지 보존 의무가 없는 MIT다. 워크숍에서 복사한 이
리포가 그대로 고객의 리포가 될 수 있다.
