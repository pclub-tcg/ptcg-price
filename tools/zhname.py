"""把日文／英文卡名翻成繁中卡名（寶可夢、道具、招式名稱用 PokeAPI 官方繁中名稱，tools/pokenames.json；
訓練家等其他名稱用 tools/names_extra.json 手動對照）。翻不出來的回傳 None。"""
import json, os, re, unicodedata

_D = os.path.dirname(os.path.abspath(__file__))
_N = json.load(open(os.path.join(_D, "pokenames.json"), encoding="utf-8"))
_X = json.load(open(os.path.join(_D, "names_extra.json"), encoding="utf-8")) if os.path.exists(os.path.join(_D, "names_extra.json")) else {"ja": {}, "en": {}}
JA = {**_N["ja"], **_X.get("ja", {})}
EN = {**_N["en"], **{k.lower(): v for k, v in _X.get("en", {}).items()}}
JA_PRE = [("メガ", "超級"), ("かがやく", "光輝"), ("ロケット団の", "火箭隊的"), ("アローラ", "阿羅拉"), ("ガラル", "伽勒爾"),
          ("ヒスイ", "洗翠"), ("パルデア", "帕底亞"), ("テラスタル", "太晶"), ("ひかる", "閃耀"), ("原始", "原始")]
EN_PRE = [("mega ", "超級"), ("radiant ", "光輝"), ("team rocket's ", "火箭隊的"), ("alolan ", "阿羅拉"), ("galarian ", "伽勒爾"),
          ("hisuian ", "洗翠"), ("paldean ", "帕底亞"), ("primal ", "原始"), ("origin forme ", "起源形態"), ("teal mask ", "碧草面具"), ("wellspring mask ", "水井面具"), ("hearthflame mask ", "火灶面具"), ("cornerstone mask ", "礎石面具"), ("ice rider ", "騎白馬的"), ("shadow rider ", "騎黑馬的"), ("single strike ", "一擊"), ("rapid strike ", "連擊"), ("ultra ", "究極"), ("white ", "白色"), ("black ", "黑色"), ("bloodmoon ", "赫月"), ("shining ", "閃耀"), ("light ", "光輝"), ("rocket's ", "火箭隊的")]
SUF_JA = r"(\s*(?:ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.X|δ|☆|◇|LEGEND|Legend|Ex|Prime|GL|G|FB|C|E4|4|[XY]))+$"


SUF_EN = SUF_JA.replace("(\\s*(?:", "(\\s+(?:", 1)


def _core(name, table, pre, ja):
    SUF = SUF_JA if ja else SUF_EN
    s = name.strip()
    full = s if ja else s.lower()
    if full in table:  # 整個名字查得到就直接用（避免「Ultra Ball」被當成「究極」＋Ball）
        return table[full]
    m0 = re.search(SUF, s)
    if m0 and (s[:m0.start()].strip() if ja else s[:m0.start()].strip().lower()) in table:
        return table[s[:m0.start()].strip() if ja else s[:m0.start()].strip().lower()] + m0.group(0).replace(" ", "")
    head = ""
    low = s.lower()
    if not ja and re.match(r"^m [a-z]", low):
        head += "超級"; s = s[2:]; low = s.lower()
    for a, b in pre:
        if (s if ja else low).startswith(a):
            head += b; s = s[len(a):].lstrip(); low = s.lower()
    m = re.search(SUF, s)
    tail = m.group(0).replace(" ", "") if m else ""
    base = s[:m.start()].strip() if m else s
    if not ja and re.match(r"^[XY]$", tail) and head == "":  # 英文名結尾的 X/Y 只在超級進化才算
        pass
    key = base if ja else base.lower()
    if key in table:
        return head + table[key] + tail
    # 「〇〇の△△」／「〇〇's △△」：訓練家的寶可夢
    sp = re.match(r"^(.+?)の(.+)$", base) if ja else re.match(r"^(.+?)'s (.+)$", base, re.I)
    if sp:
        a, b = sp.group(1), sp.group(2)
        ta, tb = table.get(a if ja else a.lower()), table.get(b if ja else b.lower())
        if ta and tb:
            return head + ta + "的" + tb + tail
    for dk in (("ダーク",) if ja else ("dark ",)):
        if key.startswith(dk) and key[len(dk):] in table:
            return head + "暗黑" + table[key[len(dk):]] + tail
    if "&" in base:
        parts = [_core(x, table, pre, ja) for x in base.split("&")]
        if all(parts):
            return head + "&".join(parts) + tail
    if " " in base and ja:
        parts = [table.get(x) for x in base.split()]
        if all(parts):
            return head + "".join(parts) + tail
    if key in (_X.get("ja") if ja else {k.lower(): v for k, v in _X.get("en", {}).items()}):
        return head + (_X["ja"] if ja else {k.lower(): v for k, v in _X["en"].items()})[key] + tail
    return None


def ja2zh(name):
    return _core(unicodedata.normalize("NFKC", name), JA, JA_PRE, True)


SEALED = [("elite trainer box", "精英訓練家禮盒"), ("booster box", "補充包盒"), ("booster bundle", "補充包組"), ("booster pack", "補充包"),
          ("3 pack blister", "三包吊卡"), ("blister", "吊卡"), ("premium collection", "高級收藏組"), ("collection box", "收藏盒"),
          ("collection", "收藏組"), ("tin", "鐵盒"), ("build & battle box", "組牌對戰盒"), ("build & battle", "組牌對戰"),
          ("booster display", "補充包盒"), ("display", "盒"), ("binder", "卡冊"), ("theme deck", "主題牌組"), ("deck", "牌組"), ("box", "盒")]


def en2zh(name, sealed=False):
    """美版名稱，例如「Charizard ex - 199/165」「Mega Charizard X ex - 125/094 (Special Illustration Rare)」"""
    base = re.split(r"\s+-\s*|\s+\(", name)[0].strip()
    base = re.sub(r"\s*\[.*?\]|\s+\d+/\d+$|\s+on the ball$|\s+oversized$", "", base, flags=re.I).strip()
    star = ""
    m = re.search(r"\s+(prism star|star|lv\.? ?x|lv\. ?\d+)$", base, re.I)
    if m:
        star = {"prism star": "◇", "star": "☆"}.get(m.group(1).lower(), "LV.X" if "x" in m.group(1).lower() else m.group(1).upper().replace(" ", ""))
        base = base[:m.start()]
    if not sealed:
        r = _core(base, EN, EN_PRE, False)
        return r + star if r else None
    low = name.lower()
    case = " case" in low
    for a, b in SEALED:
        if a in low:
            sub = re.sub(r"\s*\[.*?\]|\s*\(.*?\)", "", name)
            sub = re.sub(re.escape(a) + "|\\bcase\\b|pokemon tcg:?|pokemon", "", sub, flags=re.I)
            sub = re.sub(r"\s+", " ", sub).strip(" -:")
            return ("美版 " + (sub + " " if sub else "") + b + ("整箱" if case and b != "整箱" else "")).strip()
    return None
