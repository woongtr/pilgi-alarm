"""사람인 오픈 API로 대기업(삼성, SK, CJ, 현대, LG) 신입 공고를 받아 notices.json 에 합친다.

저장소 Secret SARAMIN_KEY 가 있을 때만 동작합니다 (없으면 조용히 건너뜀).
"""
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API = "https://oapi.saramin.co.kr/job-search"
KST = timezone(timedelta(hours=9))
OUT = os.path.join(os.path.dirname(__file__), "..", "notices.json")
# 검색어: 회사명에 들어가는 이름들
GROUPS = {
    "삼성": ["삼성"],
    "SK": ["SK", "에스케이"],
    "CJ": ["CJ", "씨제이"],
    "현대": ["현대"],
    "LG": ["LG", "엘지"],
}
NEWBIE = {"0", "1", "3"}  # 경력무관, 신입, 신입·경력


def search(key, keyword):
    q = urllib.parse.urlencode({"access-key": key, "keywords": keyword, "count": 110, "sort": "pd"})
    req = urllib.request.Request(f"{API}?{q}", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    if "result" in data and "jobs" not in data:
        raise SystemExit(f"사람인 API 오류: {data}")
    return data.get("jobs", {}).get("job", []) or []


def day(ts):
    try:
        return datetime.fromtimestamp(int(ts), KST).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return ""


def main():
    key = os.environ.get("SARAMIN_KEY", "").strip()
    if not key:
        print("SARAMIN_KEY 없음: 대기업 수집 건너뜀")
        return
    found = {}
    for group, names in GROUPS.items():
        for kw in names:
            for j in search(key, kw):
                company = (j.get("company", {}).get("detail", {}) or {}).get("name", "")
                title = (j.get("position", {}) or {}).get("title", "")
                exp = str(((j.get("position", {}) or {}).get("experience-level", {}) or {}).get("code", ""))
                if not any(n.upper() in company.upper() for n in names):
                    continue
                if str(j.get("active", "1")) != "1":
                    continue
                if exp not in NEWBIE and "신입" not in title:
                    continue
                found["s" + str(j.get("id"))] = {
                    "id": "s" + str(j.get("id")),
                    "source": "saramin",
                    "group": group,
                    "inst": company,
                    "title": title,
                    "start": day(j.get("opening-timestamp") or j.get("posting-timestamp")),
                    "end": day(j.get("expiration-timestamp")),
                    "url": j.get("url", ""),
                    "kind": ((j.get("position", {}) or {}).get("experience-level", {}) or {}).get("name", ""),
                    "hire": ((j.get("position", {}) or {}).get("job-type", {}) or {}).get("name", ""),
                }
    try:
        with open(OUT, encoding="utf-8") as f:
            out = json.load(f)
    except (OSError, ValueError):
        out = {"notices": []}
    keep = [n for n in out.get("notices", []) if n.get("source") != "saramin"]
    out["notices"] = sorted(keep + list(found.values()), key=lambda n: n.get("start", ""), reverse=True)
    out["updated"] = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"대기업 신입 공고 {len(found)}건 저장")


if __name__ == "__main__":
    main()
