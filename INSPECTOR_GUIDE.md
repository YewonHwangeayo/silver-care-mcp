# MCP Inspector 사용 가이드

## Inspector 실행 방법

### 방법 1: 인증 없이 실행 (권장)

```bash
DANGEROUSLY_OMIT_AUTH=true npx @modelcontextprotocol/inspector
```

### 방법 2: 기본 실행 (토큰 필요)

```bash
npx @modelcontextprotocol/inspector
```

터미널에 표시된 **Session Token**을 복사하세요:
```
🔑 Session token: [여기에 토큰 표시]
```

---

## Inspector UI 설정

브라우저가 자동으로 열리면 (또는 `http://localhost:6274` 접속):

### 1. Configuration 클릭
- 상단 메뉴에서 **Configuration** 또는 **Settings** 클릭

### 2. MCP Server 설정 입력

**MCP Server URL:**
```
https://silver-care-mcp.railway.app/mcp
```

**Transport Type:**
```
Streamable HTTP
```

**Connection Type:**
```
proxy
```

**Authentication (방법 2 사용 시):**
- 터미널에 표시된 Session Token 붙여넣기
- 예: `65a7a234e96fe194e6b26d6f22d337f19c287fea6644b72aeef6132fcd5c4d31`

### 3. Connect 클릭

---

## 로컬 테스트

로컬 서버를 테스트하려면:

**MCP Server URL:**
```
http://localhost:8000/mcp
```

나머지 설정은 동일합니다.

---

## 문제 해결

### "Unexpected content type: text/html"
- Railway 서버가 최신 코드로 배포되지 않았을 수 있습니다
- Railway 대시보드에서 배포 상태 확인
- 코드를 GitHub에 푸시했는지 확인

### "Did you add the proxy session token?"
- 방법 1 사용: `DANGEROUSLY_OMIT_AUTH=true`로 실행
- 방법 2 사용: Configuration에 Session Token 입력

