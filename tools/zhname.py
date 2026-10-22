"""把日文／英文卡名翻成繁中卡名（寶可夢、道具、招式名稱用 PokeAPI 官方繁中名稱，tools/pokenames.json；
訓練家等其他名稱用 tools/names_extra.json 手動對照）。翻不出來的回傳 None。"""
import json, os, re, unicodedata

_D = os.path.dirname(os.path.abspath(__file__))
_N = json.load(open(os.path.join(_D, "pokenames.json"), encoding="utf-8"))
_X = json.load(open(os.path.join(_D, "names_extra.json"), encoding="utf-8")) if os.path.exists(os.path.join(_D, "names_extra.json")) else {"ja": {}, "en": {}}
_S = json.load(open(os.path.join(_D, "setnames.json"), encoding="utf-8")) if os.path.exists(os.path.join(_D, "setnames.json")) else {"ja": {}, "en": {}}
SET_JA, SET_EN = _S.get("ja", {}), {k.lower(): v for k, v in _S.get("en", {}).items()}  # 擴充包名稱（52poke 寶可夢百科）


# 台灣官方擴充包名稱（呼卡 huca.tw/gacha.php），優先於 52poke
_T = os.path.join(_D, "setnames_tw.json")
SET_TW = json.load(open(_T, encoding="utf-8")) if os.path.exists(_T) else {}


def set_ja(name):
    return SET_TW.get(name) or SET_JA.get(name)


def set_en(name):
    n = re.sub(r"^(?:[A-Z]{1,4}\d*[a-z]?:\s*|[A-Za-z&]{2,6}\s+-\s+)", "", name or "").strip().lower()
    return SET_EN.get(n) or SET_EN.get((name or "").strip().lower())


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


SEALED = [("ultra-premium collection", "極致高級收藏組"), ("ultra premium collection", "極致高級收藏組"), ("premium figure collection", "高級公仔收藏組"),
          ("figure collection", "公仔收藏組"), ("poster collection", "海報收藏組"), ("binder collection", "卡冊收藏組"), ("pin collection", "徽章收藏組"),
          ("premium collection", "高級收藏組"), ("special collection", "特別收藏組"), ("collection box", "收藏盒"), ("collection", "收藏組"),
          ("pokemon center elite trainer box", "寶可夢中心限定 精英訓練家禮盒"), ("elite trainer box", "精英訓練家禮盒"),
          ("sleeved booster", "套袋補充包"), ("booster box", "補充包盒"), ("booster bundle", "補充包組"), ("booster display", "補充包盒"),
          ("booster pack", "補充包"), ("booster", "補充包"), ("3 pack blister", "三包吊卡"), ("3-pack blister", "三包吊卡"), ("checklane blister", "單包吊卡"),
          ("blister", "吊卡"), ("build & battle stadium", "組牌對戰場"), ("build & battle box", "組牌對戰盒"), ("build & battle", "組牌對戰盒"),
          ("mini tin", "迷你鐵盒"), ("tin", "鐵盒"), ("master carton", "大箱"), ("half booster box", "半盒"), ("art bundle", "畫作組"),
          ("pokemon center", "寶可夢中心限定"), ("trainer's toolkit", "訓練家工具箱"), ("battle deck", "對戰牌組"), ("league battle deck", "聯盟對戰牌組"),
          ("theme deck", "主題牌組"), ("starter deck", "入門牌組"), ("deck", "牌組"), ("bundle", "組合"), ("display", "盒"), ("case", "整箱"),
          ("binder", "卡冊"), ("box", "盒"), ("pack", "包"), ("sleeves", "卡套"), ("playmat", "卡墊"), ("set", "組")]


WORDS = [("scarlet & violet", "朱&紫"), ("sword & shield", "劍&盾"), ("sun & moon", "太陽&月亮"), ("black & white", "黑&白"), ("x & y", "X&Y"),
         ("first partner", "御三家"), ("collector chest", "收藏家寶箱"), ("tech sticker", "科技貼紙"), ("single pack", "單包"), ("stacking tins", "疊疊鐵盒"),
         ("pokemon", "寶可夢"), ("pokémon", "寶可夢"), ("premium", "高級"), ("galar", "伽勒爾"), ("paldea", "帕底亞"), ("kanto", "關都"), ("johto", "城都"),
         ("hoenn", "豐緣"), ("sinnoh", "神奧"), ("unova", "合眾"), ("kalos", "卡洛斯"), ("alola", "阿羅拉"), ("hisui", "洗翠"), ("legends", "傳說"),
         ("powers", "力量"), ("power", "力量"), ("partners", "夥伴"), ("league", "聯盟"), ("battle", "對戰"), ("mega", "超級"), ("mini", "迷你"),
         ("tins", "鐵盒"), ("sticker", "貼紙"), ("evolutions", "進化"), ("chest", "寶箱"), ("single", "單"), ("collector", "收藏家"), ("trainer", "訓練家"),
         ("gallery", "畫廊"), ("holiday", "節日"), ("calendar", "日曆"), ("advent", "倒數"), ("lunch box", "便當盒"), ("treasures of ruin", "災禍寶物"),
         ("paradox", "悖謬"), ("costco", "Costco 限定"), ("prerelease", "發售前活動"), ("tournament", "大賽"), ("deluxe", "豪華"), ("illustration", "插畫"), ("mythical", "幻之"), ("friends", "夥伴"), ("heroes", "英雄"), ("decks", "牌組"), ("card", "卡"), ("enhanced", "強化"), ("special", "特別"), ("international", "國際"), ("challenge", "挑戰"), ("school", "學校"), ("back to school", "開學季"), ("party", "派對"), ("checklane", "結帳區"), ("blisters", "吊卡"), ("half", "半"), ("triple", "三"), ("ancient", "古代"), ("future", "未來"), ("celebration", "慶典"), ("championship", "錦標賽"), ("world", "世界")]


def sealed2zh(name, setname=""):
    """美版原盒／周邊：系列名用中文對照（52poke），商品類型翻成中文"""
    n = re.sub(r"\s*\[.*?\]|\s*\(.*?\)", "", name)
    n = re.sub(r"pok[eé]mon tcg:?", "", n, flags=re.I)
    zs = set_en(setname)
    base = re.sub(r"^(?:[A-Z]{1,4}\d*[a-z]?:\s*|[A-Za-z&]{2,6}\s+-\s+)", "", setname or "").strip()
    if zs and base and base.lower() in n.lower():
        n = re.sub(re.escape(base), " ", n, flags=re.I)
    else:
        zs = None  # 商品名稱裡沒有系列名，就不加在前面  # 名稱裡如果有其他系列名也換掉
        for en, z in sorted(SET_EN.items(), key=lambda x: -len(x[0])):
            if len(en) > 5 and en in n.lower():
                n = re.sub(re.escape(en), " " + z + " ", n, flags=re.I); break
    for a, b in SEALED:
        n = re.sub(r"(?<![a-z])" + re.escape(a) + r"(?![a-z])", " " + b + " ", n, flags=re.I)
    def run(m):  # 剩下的英文詞組（寶可夢、訓練家名）逐段試著翻
        w = m.group(0).split()
        for i in range(len(w)):
            for j in range(len(w), i, -1):
                z = _core(" ".join(w[i:j]), EN, EN_PRE, False)
                if z:
                    return " ".join(w[:i] + [z] + w[j:]) if j - i == len(w) else " ".join(w[:i]) + " " + z + " " + run_s(" ".join(w[j:]))
        return m.group(0)
    def run_s(t):
        return re.sub(r"[A-Z][\w'’.-]*(?:\s+(?:[A-Z][\w'’.-]*|ex|EX|GX|V|VMAX|VSTAR|&))*", run, t)
    n = run_s(n)
    for a2, b2 in WORDS:
        n = re.sub(r"(?<![A-Za-z])" + re.escape(a2) + r"(?![A-Za-z])", b2, n, flags=re.I)
    n = re.sub(r"\s+", " ", (zs or "") + " " + n).strip(" -:")
    return "美版 " + n


def en2zh(name, sealed=False, setname=""):
    """美版名稱，例如「Charizard ex - 199/165」「Mega Charizard X ex - 125/094 (Special Illustration Rare)」"""
    if sealed:
        return sealed2zh(name, setname)
    base = re.split(r"\s+-\s*|\s+\(", name)[0].strip()
    base = re.sub(r"\s*\[.*?\]|\s+\d+/\d+$|\s+on the ball$|\s+oversized$", "", base, flags=re.I).strip()
    star = ""
    m = re.search(r"\s+(prism star|star|lv\.? ?x|lv\. ?\d+)$", base, re.I)
    if m:
        star = {"prism star": "◇", "star": "☆"}.get(m.group(1).lower(), "LV.X" if "x" in m.group(1).lower() else m.group(1).upper().replace(" ", ""))
        base = base[:m.start()]
    r = _core(base, EN, EN_PRE, False)
    return r + star if r else None
