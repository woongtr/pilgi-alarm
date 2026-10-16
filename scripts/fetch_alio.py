"""잡알리오(공공기관 채용정보) 공고를 받아 notices.json 으로 저장.

GitHub Actions 가 매일 실행합니다. 공공데이터포털 '기획재정부_공공기관 채용정보 조회서비스'
(data.go.kr 15125273) 인증키를 저장소 Secret ALIO_KEY 에 넣어 두세요.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API = "https://apis.data.go.kr/1051000/recruitment/list"
KST = timezone(timedelta(hours=9))
# 앱에서 지켜볼 기관 키워드. 필요하면 여기에 추가하세요.
WATCH = [
    "한국철도공사", "코레일", "한국전력공사", "국민건강보험공단", "중소기업은행",
    "한국가스공사",
]
OUT = os.path.join(os.path.dirname(__file__), "..", "notices.json")


def call(key, page, rows=100):
    q = urllib.parse.urlencode({
        "serviceKey": key, "resultType": "json", "pageNo": page,
        "numOfRows": rows, "ongoingYn": "Y",
    })
    with urllib.request.urlopen(f"{API}?{q}", timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def items_of(data):
    """응답 구조가 문서와 조금 달라도 공고 목록을 찾아낸다."""
    if isinstance(data, list):
        return data
    for k in ("result", "items", "item", "data", "body", "response"):
        v = data.get(k) if isinstance(data, dict) else None
        if isinstance(v, list):
            return v
        if isinstance(v, dict):
            found = items_of(v)
            if found:
                return found
    return []


def ymd(s):
    s = "".join(ch for ch in str(s or "") if ch.isdigit())[:8]
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else ""


def main():
    key = os.environ.get("ALIO_KEY", "").strip()
    if not key:
        sys.exit("ALIO_KEY 가 없습니다. 저장소 Settings → Secrets → Actions 에 넣어 주세요.")
    raw, page = [], 1
    while page <= 20:
        data = call(key, page)
        batch = items_of(data)
        if page == 1:
            print("응답 키:", list(data.keys()) if isinstance(data, dict) else type(data))
            if not batch:
                print(json.dumps(data, ensure_ascii=False)[:1500])
        raw += batch
        if len(batch) < 100:
            break
        page += 1
    notices = []
    for it in raw:
        inst = it.get("instNm", "")
        if not any(w in inst for w in WATCH):
            continue
        sn = it.get("recrutPblntSn", "")
        notices.append({
            "id": str(sn),
            "source": "alio",
            "group": "공공기관",
            "inst": inst,
            "title": it.get("recrutPbancTtl", ""),
            "start": ymd(it.get("pbancBgngYmd")),
            "end": ymd(it.get("pbancEndYmd")),
            "url": f"https://job.alio.go.kr/recruitview.do?idx={sn}",
            "src": it.get("srcUrl") or "",
            "kind": it.get("recrutSeNm") or "",       # 신입 / 경력
            "hire": it.get("hireTypeNmLst") or "",    # 정규직 / 비정규직 등
            "people": it.get("recrutNope") or 0,
        })
    mine = len(notices)
    # 사람인(대기업) 공고는 그대로 둔다
    try:
        with open(OUT, encoding="utf-8") as f:
            notices += [n for n in json.load(f).get("notices", []) if n.get("source") == "saramin"]
    except (OSError, ValueError):
        pass
    notices.sort(key=lambda n: n["start"], reverse=True)
    out = {"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "total": len(raw), "notices": notices}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"전체 진행 공고 {len(raw)}건 중 관심 기관 {mine}건 저장")


if __name__ == "__main__":
    main()
