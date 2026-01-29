---
description: 버전 업데이트 방법
---

# 버전 업데이트 프로세스

버전을 업데이트할 때 다음 단계를 **자동으로** 수행합니다:

## 1. 버전 정보 업데이트

`src/lib/version.ts` 파일에서 버전 정보 수정:

```typescript
export const APP_VERSION = 'v새버전명-설명';
export const BUILD_DATE = '현재날짜';
```

**예시:**
- `v2.6.0-일괄업데이트개선`
- `v2.7.0-필터기능추가`
- `v3.0.0-UI개편`

## 2. 버전 폴더 생성

프로젝트 루트에 버전명과 동일한 폴더 생성:

```powershell
New-Item -ItemType Directory -Force -Path "프로젝트루트/v새버전명-설명"
```

**예시:**
```powershell
New-Item -ItemType Directory -Force -Path "v2.6.0-일괄업데이트개선"
```

## 3. 배포

```bash
git add .
git commit -m "Update version to v새버전명-설명"
git push
```

---

## 자동화 규칙

**중요:** 앞으로 코드 변경 후 배포할 때마다:

1. ✅ `src/lib/version.ts`의 `APP_VERSION` 업데이트
2. ✅ 프로젝트 루트에 동일한 이름의 폴더 생성
3. ✅ 커밋 메시지에 버전명 포함
4. ✅ 사용자가 따로 요청하지 않아도 자동으로 수행

**버전 폴더는 Git에 커밋되지 않습니다** (`.gitignore`에 `v*/` 추가됨)

---

## 사용자 확인 방법

사용자는 다음과 같이 버전을 확인합니다:

1. **앱 내 확인:** 홈 화면 우측 하단의 버전 배지
2. **로컬 확인:** 프로젝트 폴더의 `v*` 폴더명
3. **일치 확인:** 앱 버전 = 폴더명 → 최신 버전 ✅
