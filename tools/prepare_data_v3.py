from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import sys
import unicodedata
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd


def runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


ROOT = runtime_root()
DATA_DIR = ROOT / "data"
PAYLOAD_DIR = DATA_DIR / "payload"
SOURCE_DIR = ROOT / "source_working"
CONFIG_FILE = ROOT / "dashboard_config.json"
DEFAULT_FILES = {
    "main": "ESTUDO_DESKTOP_OUTPUT/input_ESTUDO_DESKTOP_V3xlsx.xlsx",
    "support": "ESTUDO_DESKTOP_OUTPUT/input_BASE_CIDADES_APOIO.xlsx",
    "senha": "Senha_Ago.csv",
    "fluxo": "Fluxo.csv",
}


def normalize_header(value) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^A-Z0-9]+", "_", text.upper()).strip("_")


def clean_text(value) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def category(value) -> str:
    text = clean_text(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return text.upper().strip()


def number(value):
    return pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0]


def safe_float(value, decimals: int | None = None):
    if value is None or pd.isna(value):
        return None
    out = float(value)
    if not math.isfinite(out):
        return None
    return round(out, decimals) if decimals is not None else out


def safe_int(value):
    value = safe_float(value)
    return int(round(value)) if value is not None else None


def smart_coord(value):
    value = number(value)
    if pd.isna(value):
        return None
    value = float(value)
    while abs(value) > 180:
        value /= 10
    return value


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    radius = 6371.0088
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    angle = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(min(1, math.sqrt(angle)))


def is_open(value) -> bool:
    text = category(value)
    return bool(text) and "FECHADO" not in text


def weekend_label(row) -> str:
    if row["abre_sabado"] and row["abre_domingo"]:
        return "Sabado e domingo"
    if row["abre_sabado"]:
        return "Somente sabado"
    if row["abre_domingo"]:
        return "Somente domingo"
    return "Fechado no fim de semana"


def population_band(value) -> str:
    value = safe_float(value) or 0
    if value >= 300000:
        return "Acima de 300k"
    if value >= 100000:
        return "De 100k a 299k"
    if value >= 50000:
        return "De 50k a 99k"
    if value >= 30000:
        return "De 30k a 49k"
    return "Até 29K"


def value_counts_text(values, max_items=10) -> str:
    counts = Counter(v for v in values if v)
    if not counts:
        return "Sem dado"
    return ", ".join(f"{key} ({count})" for key, count in counts.most_common(max_items))


def readiness_score(row: pd.Series) -> float:
    concept = {"C24": 3, "C16": 2, "C11": 1}.get(row["conceito"], 0)
    productivity = {"PRODUTIVA": 3, "ATENCAO": 2, "IMPRODUTIVA": 1}.get(row["media_produtividade"], 0)
    m2 = safe_float(row["m2"]) or 0
    return concept * 30 + productivity * 20 + min(m2, 120) / 4 + (8 if row["abre_domingo"] else 0) + (5 if row["abre_sabado"] else 0)


def serialise(obj):
    if isinstance(obj, dict):
        return {str(key): serialise(value) for key, value in obj.items()}
    if isinstance(obj, list):
        return [serialise(value) for value in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return safe_float(obj)
    if not isinstance(obj, (str, bool)) and pd.isna(obj):
        return None
    return obj



def write_payload_parts(payload, chunk_size: int = 900_000) -> None:
    PAYLOAD_DIR.mkdir(parents=True, exist_ok=True)
    for old_part in PAYLOAD_DIR.glob("desktop-impact-data.part*.txt"):
        old_part.unlink()

    compact = json.dumps(serialise(payload), ensure_ascii=False, separators=(",", ":"))
    part_names = []
    for index, start in enumerate(range(0, len(compact), chunk_size), start=1):
        filename = f"desktop-impact-data.part{index:02d}.txt"
        (PAYLOAD_DIR / filename).write_text(compact[start:start + chunk_size], encoding="utf-8")
        part_names.append(f"payload/{filename}")

    manifest = {
        "version": 1,
        "format": "concatenated-json",
        "parts": part_names,
        "desktop_lojas": payload["summary"].get("desktop_lojas"),
        "desktop_cidades_com_loja": payload["summary"].get("desktop_cidades_com_loja"),
    }
    (PAYLOAD_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    legacy_payload = DATA_DIR / "desktop-impact-data.json"
    if legacy_payload.exists():
        legacy_payload.unlink()


def load_source_paths(config_path=None, source_dir=None) -> dict[str, Path]:
    config_file = Path(config_path).expanduser() if config_path else CONFIG_FILE
    config = json.loads(config_file.read_text(encoding="utf-8")) if config_file.exists() else {}
    raw_dir = source_dir or os.environ.get("DESKTOP_DASHBOARD_SOURCE") or config.get("source_directory", "../..")
    base = Path(raw_dir).expanduser()
    if not base.is_absolute():
        base = (ROOT / base).resolve()
    files = {**DEFAULT_FILES, **config.get("files", {})}
    paths = {key: (base / filename).resolve() for key, filename in files.items()}
    missing = [str(path) for path in paths.values() if not path.is_file()]
    if missing:
        raise FileNotFoundError("Fontes nao encontradas:\n" + "\n".join(missing))
    return paths


def copy_source(source: Path, name: str) -> Path:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    destination = SOURCE_DIR / name
    shutil.copy2(source, destination)
    return destination


def rename_columns(frame: pd.DataFrame, mapping: dict[str, str], prefixes: dict[str, str] | None = None) -> pd.DataFrame:
    normalized = {normalize_header(column): column for column in frame.columns}
    rename = {}
    for source_name, target_name in mapping.items():
        actual = normalized.get(source_name)
        if actual is not None:
            rename[actual] = target_name
    for prefix, target_name in (prefixes or {}).items():
        actual = next((column for key, column in normalized.items() if key.startswith(prefix)), None)
        if actual is not None:
            rename[actual] = target_name
    return frame.rename(columns=rename)


def require_columns(frame: pd.DataFrame, columns: list[str], sheet: str) -> None:
    missing = [column for column in columns if column not in frame.columns]
    if missing:
        raise ValueError(f"{sheet}: colunas obrigatorias ausentes: {', '.join(missing)}")


def weighted_share(frame: pd.DataFrame, share_col: str, weight_col: str):
    valid = frame.dropna(subset=[share_col, weight_col])
    total = valid[weight_col].sum()
    if total <= 0:
        return None
    return safe_float((valid[share_col] * valid[weight_col]).sum() / total, 6)


def nearest_cities(lat, lon, points: list[dict], limit=6) -> list[dict]:
    if lat is None or lon is None:
        return []
    ranked = []
    for city in points:
        if city.get("lat") is None or city.get("lon") is None:
            continue
        ranked.append((haversine_km(lat, lon, city["lat"], city["lon"]), city))
    ranked.sort(key=lambda item: item[0])
    rows = []
    for order, (distance, city) in enumerate(ranked[:limit], start=1):
        rows.append({**city, "ordem": order, "distancia_km": safe_float(distance, 1)})
    return rows


def pressure_level(base_per_store, city_count, max_distance) -> str:
    if base_per_store >= 9000 or city_count >= 6 or max_distance >= 55:
        return "ALTA"
    if base_per_store >= 3500 or city_count >= 3 or max_distance >= 30:
        return "MEDIA"
    return "BAIXA"


def main(config_path=None, source_dir=None) -> None:
    source_paths = load_source_paths(config_path=config_path, source_dir=source_dir)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    main_file = copy_source(source_paths["main"], "input_ESTUDO_DESKTOP_V3xlsx.xlsx")
    support_file = copy_source(source_paths["support"], "input_BASE_CIDADES_APOIO.xlsx")
    senha_file = copy_source(source_paths["senha"], "input_Senha_Ago.csv")
    fluxo_file = copy_source(source_paths["fluxo"], "input_Fluxo.csv")

    aa = pd.read_excel(main_file, sheet_name="BASE_AA")
    desktop = pd.read_excel(main_file, sheet_name="BASE_DESKTOP")
    general = pd.read_excel(main_file, sheet_name="BASE_GERAL")
    vivo = pd.read_excel(main_file, sheet_name="BASE_VIVO")
    apoio = pd.read_excel(support_file, sheet_name="BASE_CLIMA")

    aa = rename_columns(
        aa,
        {
            "PDV": "pdv", "GRUPO": "grupo", "CIDADE": "cidade", "COD_IBGE": "ibge",
            "TIPO_DE_LOCALIDADE": "localidade", "M2": "m2", "SABADO": "horario_sabado",
            "DOMINGO": "horario_domingo", "CONCEITO": "conceito", "QUARTIL": "quartil",
            "QUARTIL_DADOS": "quartil_dados", "QUARTIL_TV_TOTAL": "quartil_tv",
            "QUARTIL_CONTA": "quartil_conta", "QUARTIL_CONTROLE": "quartil_controle",
            "MEDIA_PRODUTIVIDADE": "media_produtividade", "TIPO": "tipo_cabo", "GN": "gn",
            "FILIAL": "filial", "TERRITORIO": "territorio", "LAT": "lat_original",
            "LONG": "lon_original", "SHARE_BL_CLARO": "share_claro_bl",
            "SHARE_POS_CLARO": "share_claro_pos", "TECNOLOGIA_CLARO": "tecnologia_claro",
            "BASE_CLARO": "base_claro",
        },
        {"NOME_DO_LOCAL": "nome_local", "2A_A_6A_FEIRA": "horario_semana"},
    )
    desktop = rename_columns(
        desktop,
        {
            "MUNICIPIO": "municipio", "DDD": "ddd", "AREA": "area", "IBGE": "ibge",
            "ATUACAO_DESKTOP": "atuacao_desktop", "ATUACAO_AA": "atuacao_aa",
            "LAT": "lat_original", "LONG": "lon_original", "SHARE_BL_DESKTOP": "share_desktop",
            "BASE_DESKTOP": "base_desktop", "LOJA_DESKTOP": "lojas_desktop",
        },
    )
    general = rename_columns(
        general,
        {
            "COD_IBGE": "ibge", "MUNICIPIO": "municipio", "SEGMENTO_PORTE": "segmento_porte",
            "TERRITORIO": "territorio", "DDD": "ddd", "POPULACAO": "populacao",
            "NET_MAIOR_REDE": "rede_claro", "CLARO": "tecnologia_claro", "VIVO": "tecnologia_vivo",
            "SHARE_CLARO_BL": "share_claro_bl", "SHARE_VIVO_BL": "share_vivo_bl",
            "SHARE_DESKTOP_BL": "share_desktop_bl_geral", "SHARE_CLARO_POS": "share_claro_pos",
            "SHARE_VIVO_POS": "share_vivo_pos", "LAT": "lat", "LONG": "lon",
        },
    )
    vivo = rename_columns(
        vivo,
        {
            "COD_IBGE": "ibge", "MUNICIPIO": "municipio", "LOJA_VIVO": "lojas_vivo",
            "LAT": "lat", "LONG": "lon", "SHARE_VIVO_BL": "share_vivo_bl",
            "SHARE_VIVO_POS": "share_vivo_pos", "TECNOLOGIA_VIVO": "tecnologia_vivo",
        },
    )
    apoio.columns = ["ibge", "municipio", "ddd", "territorio", "regional", "lat", "lon"]

    require_columns(aa, ["pdv", "grupo", "cidade", "ibge", "share_claro_bl", "share_claro_pos", "tecnologia_claro"], "BASE_AA")
    require_columns(desktop, ["municipio", "ibge", "share_desktop", "base_desktop", "lojas_desktop"], "BASE_DESKTOP")
    require_columns(general, ["ibge", "municipio", "populacao", "share_claro_bl", "share_vivo_bl", "share_claro_pos", "share_vivo_pos"], "BASE_GERAL")
    require_columns(vivo, ["ibge", "municipio", "lojas_vivo"], "BASE_VIVO")

    for frame in [aa, desktop, general, vivo, apoio]:
        frame["ibge"] = pd.to_numeric(frame["ibge"], errors="coerce").astype("Int64")

    for frame, columns in [
        (aa, ["m2", "share_claro_bl", "share_claro_pos", "base_claro"]),
        (desktop, ["ddd", "atuacao_desktop", "atuacao_aa", "share_desktop", "base_desktop", "lojas_desktop"]),
        (general, ["ddd", "populacao", "share_claro_bl", "share_vivo_bl", "share_desktop_bl_geral", "share_claro_pos", "share_vivo_pos", "lat", "lon"]),
        (vivo, ["lojas_vivo", "lat", "lon", "share_vivo_bl", "share_vivo_pos"]),
        (apoio, ["lat", "lon"]),
    ]:
        for column in columns:
            if column in frame.columns:
                frame[column] = pd.to_numeric(frame[column], errors="coerce")

    for column in ["pdv", "grupo", "cidade", "localidade", "nome_local", "horario_semana", "horario_sabado", "horario_domingo", "conceito", "media_produtividade", "tipo_cabo", "gn", "filial", "territorio", "tecnologia_claro"]:
        if column not in aa.columns:
            aa[column] = ""
        aa[column] = aa[column].map(clean_text)
    for column in ["municipio", "area"]:
        desktop[column] = desktop[column].map(clean_text)
    for column in ["municipio", "segmento_porte", "territorio", "rede_claro", "tecnologia_claro", "tecnologia_vivo"]:
        if column not in general.columns:
            general[column] = ""
        general[column] = general[column].map(clean_text)
    for column in ["municipio", "tecnologia_vivo"]:
        vivo[column] = vivo[column].map(clean_text)

    for column in ["pdv", "grupo", "localidade", "conceito", "media_produtividade", "tipo_cabo"]:
        aa[column] = aa[column].map(category)
    desktop["area"] = desktop["area"].map(category)

    support_coords = {
        int(row.ibge): (safe_float(row.lat), safe_float(row.lon))
        for row in apoio.dropna(subset=["ibge", "lat", "lon"]).itertuples(index=False)
    }
    general["lat"] = general.apply(lambda row: safe_float(row["lat"]) if pd.notna(row["lat"]) else support_coords.get(int(row["ibge"]), (None, None))[0], axis=1)
    general["lon"] = general.apply(lambda row: safe_float(row["lon"]) if pd.notna(row["lon"]) else support_coords.get(int(row["ibge"]), (None, None))[1], axis=1)
    general["faixa_pop"] = general["populacao"].map(population_band)
    general_lookup = {int(row.ibge): row._asdict() for row in general.itertuples(index=False) if pd.notna(row.ibge)}

    desktop["lat"] = desktop.apply(lambda row: general_lookup.get(int(row["ibge"]), {}).get("lat") if pd.notna(row["ibge"]) else smart_coord(row["lat_original"]), axis=1)
    desktop["lon"] = desktop.apply(lambda row: general_lookup.get(int(row["ibge"]), {}).get("lon") if pd.notna(row["ibge"]) else smart_coord(row["lon_original"]), axis=1)
    aa["lat"] = aa.apply(lambda row: general_lookup.get(int(row["ibge"]), {}).get("lat") if pd.notna(row["ibge"]) else smart_coord(row["lat_original"]), axis=1)
    aa["lon"] = aa.apply(lambda row: general_lookup.get(int(row["ibge"]), {}).get("lon") if pd.notna(row["ibge"]) else smart_coord(row["lon_original"]), axis=1)

    senha = pd.read_csv(senha_file, sep=";", encoding="cp1252", low_memory=False)
    senha["pdv"] = senha["AMDOCS"].map(category)
    senha["data"] = pd.to_datetime(senha["Data"], errors="coerce")
    senha["cancelado_num"] = pd.to_numeric(senha["Cancelado"], errors="coerce").fillna(0).astype(int)
    senha["tempo_atendimento_td"] = pd.to_timedelta(senha["Tempo Atendimento"], errors="coerce")
    senha["atendida"] = senha["cancelado_num"].eq(0)
    senha["suspeita_menos_1min"] = senha["atendida"] & senha["tempo_atendimento_td"].lt(pd.Timedelta(minutes=1))
    senha["suspeita_zero"] = senha["atendida"] & senha["tempo_atendimento_td"].eq(pd.Timedelta(0))
    senha_store = senha.groupby("pdv", dropna=False).agg(
        senhas_emitidas=("pdv", "size"), senhas_atendidas=("atendida", "sum"),
        senhas_canceladas=("cancelado_num", lambda values: int((values != 0).sum())),
        senhas_suspeitas=("suspeita_menos_1min", "sum"), senhas_zero=("suspeita_zero", "sum"),
        dias_com_senha=("data", "nunique"),
    ).reset_index()
    attended = senha[senha["atendida"]]
    times = attended.groupby("pdv")["tempo_atendimento_td"].agg(["mean", "median"]).reset_index()
    times["tempo_atendimento_medio_seg"] = times["mean"].dt.total_seconds()
    times["tempo_atendimento_mediano_seg"] = times["median"].dt.total_seconds()
    senha_store = senha_store.merge(times[["pdv", "tempo_atendimento_medio_seg", "tempo_atendimento_mediano_seg"]], on="pdv", how="left")
    senha_store["taxa_suspeita"] = senha_store["senhas_suspeitas"] / senha_store["senhas_atendidas"].replace(0, np.nan)

    fluxo = pd.read_csv(fluxo_file, sep=";", encoding="cp1252", skiprows=3, low_memory=False)
    fluxo = fluxo.rename(columns={
        fluxo.columns[2]: "pdv", fluxo.columns[5]: "fluxo_atendimentos", fluxo.columns[8]: "fluxo_movel",
        fluxo.columns[14]: "fluxo_residencial", fluxo.columns[20]: "fluxo_conta", fluxo.columns[26]: "fluxo_controle",
        fluxo.columns[32]: "fluxo_bl", fluxo.columns[48]: "fluxo_bl_fixo",
    })
    fluxo["pdv"] = fluxo["pdv"].map(category)
    fluxo = fluxo[fluxo["pdv"] != ""].copy()
    fluxo_columns = ["fluxo_atendimentos", "fluxo_movel", "fluxo_residencial", "fluxo_conta", "fluxo_controle", "fluxo_bl", "fluxo_bl_fixo"]
    for column in fluxo_columns:
        fluxo[column] = pd.to_numeric(fluxo[column], errors="coerce")
    fluxo_store = fluxo[["pdv", *fluxo_columns]].copy()

    aa["abre_sabado"] = aa["horario_sabado"].map(is_open)
    aa["abre_domingo"] = aa["horario_domingo"].map(is_open)
    aa["fim_semana"] = aa.apply(weekend_label, axis=1)
    aa["is_xpto"] = aa["pdv"].str.startswith("XPTO")
    aa["readiness_score"] = aa.apply(readiness_score, axis=1)
    aa["populacao"] = aa["ibge"].map(lambda code: general_lookup.get(int(code), {}).get("populacao") if pd.notna(code) else None)
    aa["faixa_pop"] = aa["populacao"].map(population_band)
    aa["segmento_porte"] = aa["ibge"].map(lambda code: general_lookup.get(int(code), {}).get("segmento_porte") if pd.notna(code) else "")

    store_columns = [
        "pdv", "grupo", "cidade", "ibge", "localidade", "m2", "nome_local", "horario_semana",
        "horario_sabado", "horario_domingo", "fim_semana", "conceito", "quartil", "quartil_dados",
        "quartil_tv", "quartil_conta", "quartil_controle", "media_produtividade", "tipo_cabo", "gn",
        "filial", "territorio", "populacao", "faixa_pop", "segmento_porte", "abre_sabado", "abre_domingo",
        "lat", "lon", "share_claro_bl", "share_claro_pos", "tecnologia_claro",
        "base_claro", "is_xpto", "readiness_score",
    ]
    for column in store_columns:
        if column not in aa.columns:
            aa[column] = None
    stores = aa[store_columns].copy().merge(senha_store, on="pdv", how="left").merge(fluxo_store, on="pdv", how="left")
    stores["share_claro"] = stores["share_claro_bl"]
    fluxo_q75 = stores["fluxo_atendimentos"].quantile(0.75)
    suspeita_q75 = stores.loc[stores["senhas_atendidas"] >= 100, "taxa_suspeita"].quantile(0.75)
    stores["acao_operacional"] = stores.apply(
        lambda row: "COMPLETAR DADOS" if pd.isna(row["senhas_atendidas"]) and pd.isna(row["fluxo_atendimentos"])
        else "VALIDAR PROCESSO DE SENHAS" if pd.notna(row["taxa_suspeita"]) and row["senhas_atendidas"] >= 100 and row["taxa_suspeita"] >= suspeita_q75
        else "MONITORAR ALTO VOLUME" if pd.notna(row["fluxo_atendimentos"]) and row["fluxo_atendimentos"] >= fluxo_q75
        else "ROTINA", axis=1,
    )

    desktop_base_by_ibge = desktop.set_index("ibge")["base_desktop"].to_dict()
    city_rows = []
    for ibge, group in stores.groupby("ibge", dropna=False):
        group = group.sort_values(["readiness_score", "m2"], ascending=[False, False])
        anchor = group.iloc[0]
        general_city = general_lookup.get(int(ibge), {}) if pd.notna(ibge) else {}
        base_claro = group["base_claro"].max()
        base_desktop = desktop_base_by_ibge.get(ibge)
        city_rows.append({
            "ibge": safe_int(ibge), "cidade": anchor["cidade"], "populacao": safe_int(general_city.get("populacao")),
            "faixa_pop": population_band(general_city.get("populacao")), "segmento_porte": general_city.get("segmento_porte"),
            "lat": safe_float(anchor["lat"], 6), "lon": safe_float(anchor["lon"], 6), "lojas": int(len(group)),
            "lojas_rua": int((group["localidade"] == "RUA").sum()), "lojas_shopping": int((group["localidade"] == "SHOPPING").sum()),
            "m2_medio": safe_float(group["m2"].mean(), 1), "m2_min": safe_float(group["m2"].min(), 1), "m2_max": safe_float(group["m2"].max(), 1),
            "conceitos": value_counts_text(group["conceito"]), "produtividade_mix": value_counts_text(group["media_produtividade"]),
            "grupos_mix": value_counts_text(group["grupo"]), "lojas_resumo": "; ".join(f"{row.pdv} - {row.grupo}" for row in group.itertuples(index=False)),
            "lojas_detalhes": "; ".join(f"{row.pdv} - {row.grupo} - {row.conceito} - {safe_float(row.m2, 1)} m2 - {row.localidade}" for row in group.itertuples(index=False)),
            "lojas_produtivas": int((group["media_produtividade"] == "PRODUTIVA").sum()), "abre_sabado_qtd": int(group["abre_sabado"].sum()),
            "abre_domingo_qtd": int(group["abre_domingo"].sum()), "fim_semana_mix": value_counts_text(group["fim_semana"]),
            "tipo_cabo": anchor["tipo_cabo"], "territorio": anchor["territorio"], "filial_principal": anchor["filial"], "gn_principal": anchor["gn"],
            "share_claro": safe_float(general_city.get("share_claro_bl"), 6), "share_claro_bl": safe_float(general_city.get("share_claro_bl"), 6),
            "share_claro_pos": safe_float(general_city.get("share_claro_pos"), 6), "share_vivo_bl": safe_float(general_city.get("share_vivo_bl"), 6),
            "share_vivo_pos": safe_float(general_city.get("share_vivo_pos"), 6), "tecnologia_claro": general_city.get("tecnologia_claro"),
            "tecnologia_vivo": general_city.get("tecnologia_vivo"), "base_claro": safe_float(base_claro, 2),
            "base_desktop": safe_float(base_desktop, 0),
            "senhas_emitidas": safe_int(group["senhas_emitidas"].sum(min_count=1)), "senhas_atendidas": safe_int(group["senhas_atendidas"].sum(min_count=1)),
            "senhas_canceladas": safe_int(group["senhas_canceladas"].sum(min_count=1)), "senhas_suspeitas": safe_int(group["senhas_suspeitas"].sum(min_count=1)),
            "fluxo_atendimentos": safe_int(group["fluxo_atendimentos"].sum(min_count=1)), "fluxo_por_loja": safe_float(group["fluxo_atendimentos"].sum(min_count=1) / len(group), 1),
            "taxa_suspeita": safe_float(group["senhas_suspeitas"].sum(min_count=1) / group["senhas_atendidas"].sum(min_count=1), 6) if group["senhas_atendidas"].sum(min_count=1) not in [None, 0] and not pd.isna(group["senhas_atendidas"].sum(min_count=1)) else None,
            "anchor_pdv": anchor["pdv"], "anchor_grupo": anchor["grupo"], "anchor_localidade": anchor["localidade"],
            "anchor_m2": safe_float(anchor["m2"], 1), "anchor_conceito": anchor["conceito"], "anchor_produtividade": anchor["media_produtividade"],
            "anchor_fim_semana": anchor["fim_semana"], "anchor_horario_semana": anchor["horario_semana"],
            "anchor_horario_sabado": anchor["horario_sabado"], "anchor_horario_domingo": anchor["horario_domingo"],
        })
    aa_cities = pd.DataFrame(city_rows)
    aa_lookup = {int(row.ibge): row._asdict() for row in aa_cities.itertuples(index=False)}

    vivo_rows = []
    for row in vivo.itertuples(index=False):
        general_city = general_lookup.get(int(row.ibge), {})
        vivo_rows.append({
            "ibge": safe_int(row.ibge), "cidade": clean_text(row.municipio), "lojas": safe_int(row.lojas_vivo) or 0,
            "lat": safe_float(general_city.get("lat") if general_city else row.lat, 6), "lon": safe_float(general_city.get("lon") if general_city else row.lon, 6),
            "populacao": safe_int(general_city.get("populacao")), "faixa_pop": population_band(general_city.get("populacao")),
            "segmento_porte": general_city.get("segmento_porte"), "territorio": general_city.get("territorio"),
            "share_vivo_bl": safe_float(general_city.get("share_vivo_bl", row.share_vivo_bl), 6),
            "share_vivo_pos": safe_float(general_city.get("share_vivo_pos", row.share_vivo_pos), 6),
            "tecnologia_vivo": general_city.get("tecnologia_vivo") or row.tecnologia_vivo,
        })
    vivo_cities = pd.DataFrame(vivo_rows)
    vivo_lookup = {int(row.ibge): row._asdict() for row in vivo_cities.itertuples(index=False)}
    aa_points = aa_cities.to_dict(orient="records")
    vivo_points = vivo_cities.to_dict(orient="records")

    desktop_rows = []
    for row in desktop.itertuples(index=False):
        ibge = int(row.ibge)
        general_city = general_lookup.get(ibge, {})
        own_aa = aa_lookup.get(ibge)
        own_vivo = vivo_lookup.get(ibge)
        lat, lon = safe_float(row.lat, 6), safe_float(row.lon, 6)
        nearby_aa = nearest_cities(lat, lon, aa_points, 6)
        nearby_vivo = nearest_cities(lat, lon, vivo_points, 6)
        nearest_aa = nearby_aa[0] if nearby_aa else {}
        nearest_vivo = nearby_vivo[0] if nearby_vivo else {}
        base_desktop = safe_float(row.base_desktop, 2) or 0
        share_desktop = safe_float(row.share_desktop, 6)
        population = safe_int(general_city.get("populacao"))
        has_aa, has_vivo = own_aa is not None, own_vivo is not None
        base_claro = safe_float(own_aa.get("base_claro"), 0) if has_aa else None
        coverage = "AA + Vivo" if has_aa and has_vivo else "Somente AA" if has_aa else "Somente Vivo" if has_vivo else "Sem loja AA/Vivo"
        desktop_rows.append({
            "ibge": ibge, "municipio": clean_text(row.municipio), "ddd": safe_int(row.ddd), "area": category(row.area),
            "populacao": population, "faixa_pop": population_band(population), "segmento_porte": general_city.get("segmento_porte"),
            "territorio_geral": general_city.get("territorio"), "rede_claro": general_city.get("rede_claro"), "lat": lat, "lon": lon,
            "atuacao_desktop": safe_int(row.atuacao_desktop), "atuacao_aa_planilha": safe_int(row.atuacao_aa),
            "tem_loja_aa": has_aa, "lojas_aa": safe_int(own_aa.get("lojas")) if own_aa else 0,
            "tem_loja_vivo": has_vivo, "lojas_vivo": safe_int(own_vivo.get("lojas")) if own_vivo else 0,
            "lojas_desktop": safe_int(row.lojas_desktop) or 0, "tem_loja_desktop": bool((safe_int(row.lojas_desktop) or 0) > 0),
            "status_cobertura": "Com loja do Canal AA" if has_aa else "Sem loja do Canal AA", "status_competitivo": coverage,
            "share_desktop": share_desktop, "share_desktop_bl_geral": safe_float(general_city.get("share_desktop_bl_geral"), 6),
            "share_claro": safe_float(general_city.get("share_claro_bl"), 6), "share_claro_bl": safe_float(general_city.get("share_claro_bl"), 6),
            "share_vivo_bl": safe_float(general_city.get("share_vivo_bl"), 6), "share_claro_pos": safe_float(general_city.get("share_claro_pos"), 6),
            "share_vivo_pos": safe_float(general_city.get("share_vivo_pos"), 6), "tecnologia_claro": general_city.get("tecnologia_claro"),
            "tecnologia_vivo": general_city.get("tecnologia_vivo"), "base_desktop": base_desktop,
            "base_desktop_por_mil_hab": safe_float(base_desktop / population * 1000, 2) if population else None,
            "share_combinado_potencial": safe_float((safe_float(general_city.get("share_claro_bl")) or 0) + share_desktop, 6) if share_desktop is not None else None,
            "base_claro": base_claro,
            "cidades_aa_proximas": nearby_aa, "cidades_vivo_proximas": nearby_vivo,
            "receptor_ibge": nearest_aa.get("ibge"), "receptor_cidade": nearest_aa.get("cidade"), "distancia_receptor_km": nearest_aa.get("distancia_km"),
            "receptor_lojas": nearest_aa.get("lojas"), "receptor_lojas_rua": nearest_aa.get("lojas_rua"), "receptor_lojas_shopping": nearest_aa.get("lojas_shopping"),
            "receptor_conceitos": nearest_aa.get("conceitos"), "receptor_produtividade_mix": nearest_aa.get("produtividade_mix"),
            "receptor_m2_medio": nearest_aa.get("m2_medio"), "receptor_fim_semana_mix": nearest_aa.get("fim_semana_mix"),
            "receptor_grupos_mix": nearest_aa.get("grupos_mix"), "receptor_lojas_resumo": nearest_aa.get("lojas_resumo"),
            "receptor_territorio": nearest_aa.get("territorio"),
            "receptor_base_claro": nearest_aa.get("base_claro"), "receptor_base_desktop": nearest_aa.get("base_desktop"),
            "loja_referencia_pdv": nearest_aa.get("anchor_pdv"), "loja_referencia_grupo": nearest_aa.get("anchor_grupo"),
            "loja_referencia_localidade": nearest_aa.get("anchor_localidade"), "loja_referencia_m2": nearest_aa.get("anchor_m2"),
            "loja_referencia_conceito": nearest_aa.get("anchor_conceito"), "loja_referencia_produtividade": nearest_aa.get("anchor_produtividade"),
            "loja_referencia_fim_semana": nearest_aa.get("anchor_fim_semana"), "loja_referencia_semana": nearest_aa.get("anchor_horario_semana"),
            "loja_referencia_sabado": nearest_aa.get("anchor_horario_sabado"), "loja_referencia_domingo": nearest_aa.get("anchor_horario_domingo"),
            "vivo_referencia_ibge": nearest_vivo.get("ibge"), "vivo_referencia_cidade": nearest_vivo.get("cidade"),
            "distancia_vivo_km": nearest_vivo.get("distancia_km"), "vivo_referencia_lojas": nearest_vivo.get("lojas"),
        })
    desktop_enriched = pd.DataFrame(desktop_rows)

    noaa = desktop_enriched[~desktop_enriched["tem_loja_aa"]].copy()
    withaa = desktop_enriched[desktop_enriched["tem_loja_aa"]].copy()
    receptors_rows = []
    for receptor_ibge, group in desktop_enriched.groupby("receptor_ibge", dropna=False):
        if pd.isna(receptor_ibge):
            continue
        city = aa_lookup.get(int(receptor_ibge), {})
        external = group[~group["tem_loja_aa"]]
        local = group[group["tem_loja_aa"]]
        store_count = city.get("lojas") or 1
        max_distance = external["distancia_receptor_km"].max() if len(external) else 0
        weighted_distance = weighted_share(external.rename(columns={"distancia_receptor_km": "value"}), "value", "base_desktop") if len(external) else 0
        source_pool = external if len(external) else group
        top_source = source_pool.sort_values("base_desktop", ascending=False).iloc[0]
        base_external = external["base_desktop"].sum()
        receptors_rows.append({
            "receptor_ibge": safe_int(receptor_ibge), "receptor_cidade": city.get("cidade"), "populacao": city.get("populacao"),
            "faixa_pop": city.get("faixa_pop"), "territorio": city.get("territorio"), "lat": city.get("lat"), "lon": city.get("lon"),
            "lojas": city.get("lojas"), "lojas_rua": city.get("lojas_rua"), "lojas_shopping": city.get("lojas_shopping"),
            "conceitos": city.get("conceitos"), "produtividade_mix": city.get("produtividade_mix"), "grupos_mix": city.get("grupos_mix"),
            "lojas_resumo": city.get("lojas_resumo"), "m2_medio": city.get("m2_medio"), "fim_semana_mix": city.get("fim_semana_mix"),
            "share_claro": city.get("share_claro"), "share_claro_pos": city.get("share_claro_pos"), "share_vivo_bl": city.get("share_vivo_bl"),
            "share_vivo_pos": city.get("share_vivo_pos"), "base_claro": city.get("base_claro"), "base_desktop_cidade": city.get("base_desktop"),
            "senhas_emitidas": city.get("senhas_emitidas"), "senhas_atendidas": city.get("senhas_atendidas"), "senhas_canceladas": city.get("senhas_canceladas"),
            "senhas_suspeitas": city.get("senhas_suspeitas"), "fluxo_atendimentos": city.get("fluxo_atendimentos"), "fluxo_por_loja": city.get("fluxo_por_loja"),
            "taxa_suspeita": city.get("taxa_suspeita"), "desktop_cidades_total": int(len(group)), "desktop_cidades_sem_aa": int(len(external)),
            "desktop_cidades_com_aa": int(len(local)), "base_desktop_total": safe_float(group["base_desktop"].sum(), 2),
            "base_desktop_sem_aa": safe_float(base_external, 2), "base_desktop_com_aa": safe_float(local["base_desktop"].sum(), 2),
            "base_sem_aa_por_loja": safe_float(base_external / store_count, 1), "base_total_por_loja": safe_float(group["base_desktop"].sum() / store_count, 1),
            "distancia_max_sem_aa_km": safe_float(max_distance, 1), "distancia_media_ponderada_sem_aa_km": safe_float(weighted_distance, 1),
            "maior_origem": top_source["municipio"], "maior_origem_base": safe_float(top_source["base_desktop"], 0),
            "nivel_pressao": pressure_level(base_external / store_count, len(external), max_distance or 0),
            "anchor_pdv": city.get("anchor_pdv"), "anchor_grupo": city.get("anchor_grupo"), "anchor_conceito": city.get("anchor_conceito"),
            "anchor_m2": city.get("anchor_m2"), "anchor_produtividade": city.get("anchor_produtividade"), "anchor_fim_semana": city.get("anchor_fim_semana"),
        })
    receptors = pd.DataFrame(receptors_rows)
    receptors["acao_recomendada"] = "ANALISAR CAPACIDADE"

    stores["demanda_externa_teorica"] = 0.0
    origins = {pdv: [] for pdv in stores["pdv"]}
    for row in noaa.itertuples(index=False):
        target = stores.index[stores["ibge"] == row.receptor_ibge].tolist()
        if not target:
            continue
        allocation = row.base_desktop / len(target)
        for index in target:
            stores.at[index, "demanda_externa_teorica"] += allocation
            origins[stores.at[index, "pdv"]].append(row.municipio)
    stores["cidades_origem_qtd"] = stores["pdv"].map(lambda pdv: len(origins.get(pdv, [])))
    stores["cidades_origem"] = stores["pdv"].map(lambda pdv: ", ".join(origins.get(pdv, [])))

    impact_rows = []
    for group_name, group in stores.groupby("grupo", dropna=False):
        impacted = group[group["demanda_externa_teorica"] > 0]
        origin_names = sorted({name for pdv in group["pdv"] for name in origins.get(pdv, [])})
        impact_rows.append({
            "grupo": group_name, "demanda_externa_teorica": safe_float(group["demanda_externa_teorica"].sum(), 1),
            "lojas_total": int(len(group)), "lojas_impactadas": int(len(impacted)), "cidades_origem_qtd": len(origin_names),
            "cidades_origem": ", ".join(origin_names), "pdvs_impactados": ", ".join(impacted.sort_values("demanda_externa_teorica", ascending=False)["pdv"]),
            "fluxo_atendimentos": safe_int(group["fluxo_atendimentos"].sum(min_count=1)), "senhas_atendidas": safe_int(group["senhas_atendidas"].sum(min_count=1)),
            "taxa_suspeita": safe_float(group["senhas_suspeitas"].sum(min_count=1) / group["senhas_atendidas"].sum(min_count=1), 6) if group["senhas_atendidas"].sum(min_count=1) not in [None, 0] and not pd.isna(group["senhas_atendidas"].sum(min_count=1)) else None,
        })
    impact_groups = pd.DataFrame(impact_rows).sort_values("demanda_externa_teorica", ascending=False)

    far_threshold = noaa["distancia_receptor_km"].quantile(0.75)
    far_cities = noaa[noaa["distancia_receptor_km"] >= far_threshold].reset_index(drop=True)
    parent = list(range(len(far_cities)))
    def find_parent(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index
    def union(left, right):
        left_root, right_root = find_parent(left), find_parent(right)
        if left_root != right_root:
            parent[right_root] = left_root
    for left in range(len(far_cities)):
        for right in range(left + 1, len(far_cities)):
            if haversine_km(far_cities.at[left, "lat"], far_cities.at[left, "lon"], far_cities.at[right, "lat"], far_cities.at[right, "lon"]) <= 35:
                union(left, right)
    raw_clusters = {}
    for index in range(len(far_cities)):
        raw_clusters.setdefault(find_parent(index), []).append(far_cities.iloc[index])
    cluster_candidates = []
    for members in raw_clusters.values():
        if len(members) < 2:
            continue
        members = sorted(members, key=lambda item: item["base_desktop"], reverse=True)
        member_records = [{key: serialise(item[key]) for key in [
            "ibge", "municipio", "lat", "lon", "populacao", "faixa_pop", "area", "base_desktop", "share_desktop",
            "share_claro_bl", "share_vivo_bl", "share_claro_pos", "share_vivo_pos", "lojas_desktop", "lojas_vivo",
            "tecnologia_claro", "tecnologia_vivo", "receptor_cidade", "distancia_receptor_km", "vivo_referencia_cidade", "distancia_vivo_km",
        ]} for item in members]
        centroid_lat = sum(item["lat"] for item in members) / len(members)
        centroid_lon = sum(item["lon"] for item in members) / len(members)
        member_frame = pd.DataFrame(member_records)
        def network_context(points, limit=12):
            ranked = []
            for point in points:
                distance = min(haversine_km(member["lat"], member["lon"], point["lat"], point["lon"]) for member in member_records)
                if distance <= 75:
                    ranked.append({**point, "distancia_cluster_km": safe_float(distance, 1)})
            return sorted(ranked, key=lambda item: item["distancia_cluster_km"])[:limit]
        cluster_candidates.append({
            "cluster": members[0]["municipio"], "cidades_qtd": len(members), "cidades": ", ".join(item["municipio"] for item in members),
            "base_desktop": safe_float(member_frame["base_desktop"].sum(), 0), "populacao": safe_int(member_frame["populacao"].sum()),
            "share_desktop": weighted_share(member_frame, "share_desktop", "base_desktop"),
            "share_claro_bl": weighted_share(member_frame, "share_claro_bl", "populacao"), "share_vivo_bl": weighted_share(member_frame, "share_vivo_bl", "populacao"),
            "share_claro_pos": weighted_share(member_frame, "share_claro_pos", "populacao"), "share_vivo_pos": weighted_share(member_frame, "share_vivo_pos", "populacao"),
            "lojas_desktop": safe_int(member_frame["lojas_desktop"].sum()), "lojas_vivo": safe_int(member_frame["lojas_vivo"].sum()),
            "tipos": value_counts_text(member_frame["area"]), "distancia_media_loja_km": safe_float(member_frame["distancia_receptor_km"].mean(), 1),
            "faixa_distancia_minima_km": safe_float(far_threshold, 1), "lat": safe_float(centroid_lat, 6), "lon": safe_float(centroid_lon, 6),
            "members": member_records, "nearbyAa": network_context(aa_points), "nearbyVivo": network_context(vivo_points),
        })
    cluster_candidates.sort(key=lambda item: item["base_desktop"], reverse=True)
    for index, cluster in enumerate(cluster_candidates, start=1):
        cluster["cluster_id"] = f"cluster-{index}"

    aa_codes = set(aa["ibge"].dropna().astype(int))
    vivo_codes = set(vivo["ibge"].dropna().astype(int))
    desktop_codes = set(desktop["ibge"].dropna().astype(int))
    general_rows = []
    for row in general.itertuples(index=False):
        ibge = int(row.ibge)
        general_rows.append({
            "ibge": ibge, "municipio": clean_text(row.municipio), "segmento_porte": clean_text(row.segmento_porte),
            "territorio": clean_text(row.territorio), "ddd": safe_int(row.ddd), "populacao": safe_int(row.populacao),
            "faixa_pop": population_band(row.populacao), "rede_claro": clean_text(row.rede_claro), "tecnologia_claro": clean_text(row.tecnologia_claro),
            "tecnologia_vivo": clean_text(row.tecnologia_vivo), "share_claro_bl": safe_float(row.share_claro_bl, 6),
            "share_vivo_bl": safe_float(row.share_vivo_bl, 6), "share_desktop_bl": safe_float(row.share_desktop_bl_geral, 6),
            "share_claro_pos": safe_float(row.share_claro_pos, 6), "share_vivo_pos": safe_float(row.share_vivo_pos, 6),
            "lat": safe_float(row.lat, 6), "lon": safe_float(row.lon, 6), "tem_loja_aa": ibge in aa_codes,
            "tem_loja_vivo": ibge in vivo_codes, "tem_desktop": ibge in desktop_codes,
            "lojas_aa": safe_int(aa_lookup.get(ibge, {}).get("lojas")) or 0, "lojas_vivo": safe_int(vivo_lookup.get(ibge, {}).get("lojas")) or 0,
        })

    segment_specs = [
        ("AA + Vivo", desktop_enriched["tem_loja_aa"] & desktop_enriched["tem_loja_vivo"]),
        ("Somente AA", desktop_enriched["tem_loja_aa"] & ~desktop_enriched["tem_loja_vivo"]),
        ("Somente Vivo", ~desktop_enriched["tem_loja_aa"] & desktop_enriched["tem_loja_vivo"]),
        ("Sem loja AA/Vivo", ~desktop_enriched["tem_loja_aa"] & ~desktop_enriched["tem_loja_vivo"]),
    ]
    coverage_segments = []
    for name, mask in segment_specs:
        frame = desktop_enriched[mask]
        coverage_segments.append({
            "segmento": name, "cidades": int(len(frame)), "populacao": safe_int(frame["populacao"].sum()),
            "base_desktop": safe_float(frame["base_desktop"].sum(), 0), "lojas_aa": safe_int(frame["lojas_aa"].sum()),
            "lojas_vivo": safe_int(frame["lojas_vivo"].sum()), "lojas_desktop": safe_int(frame["lojas_desktop"].sum()),
            "share_desktop": weighted_share(frame, "share_desktop", "base_desktop"),
            "share_claro_bl": weighted_share(frame, "share_claro_bl", "populacao"), "share_vivo_bl": weighted_share(frame, "share_vivo_bl", "populacao"),
            "share_claro_pos": weighted_share(frame, "share_claro_pos", "populacao"), "share_vivo_pos": weighted_share(frame, "share_vivo_pos", "populacao"),
        })

    summary = {
        "generated_at": pd.Timestamp.now().isoformat(timespec="seconds"),
        "source_files": {key: value.name for key, value in source_paths.items()},
        "aa_lojas": int(len(stores)), "aa_cidades": int(aa_cities["ibge"].nunique()),
        "vivo_lojas": safe_int(vivo_cities["lojas"].sum()), "vivo_cidades": int(vivo_cities["ibge"].nunique()),
        "desktop_lojas": safe_int(desktop_enriched["lojas_desktop"].sum()), "desktop_cidades_com_loja": int(desktop_enriched["tem_loja_desktop"].sum()),
        "desktop_cidades": int(len(desktop_enriched)), "desktop_com_aa": int(desktop_enriched["tem_loja_aa"].sum()),
        "desktop_sem_aa": int((~desktop_enriched["tem_loja_aa"]).sum()), "desktop_com_vivo": int(desktop_enriched["tem_loja_vivo"].sum()),
        "desktop_sem_vivo": int((~desktop_enriched["tem_loja_vivo"]).sum()), "desktop_com_aa_e_vivo": int((desktop_enriched["tem_loja_aa"] & desktop_enriched["tem_loja_vivo"]).sum()),
        "desktop_sem_aa_e_vivo": int((~desktop_enriched["tem_loja_aa"] & ~desktop_enriched["tem_loja_vivo"]).sum()),
        "desktop_base_total": safe_float(desktop_enriched["base_desktop"].sum(), 0), "desktop_base_com_aa": safe_float(withaa["base_desktop"].sum(), 0),
        "desktop_base_sem_aa": safe_float(noaa["base_desktop"].sum(), 0), "desktop_base_sem_aa_pct": safe_float(noaa["base_desktop"].sum() / desktop_enriched["base_desktop"].sum(), 6),
        "populacao_desktop": safe_int(desktop_enriched["populacao"].sum()), "share_desktop_ponderado_total": weighted_share(desktop_enriched, "share_desktop", "base_desktop"),
        "share_desktop_ponderado_com_aa": weighted_share(withaa, "share_desktop", "base_desktop"), "share_desktop_ponderado_sem_aa": weighted_share(noaa, "share_desktop", "base_desktop"),
        "share_claro_bl_pop_ponderado": weighted_share(desktop_enriched, "share_claro_bl", "populacao"), "share_vivo_bl_pop_ponderado": weighted_share(desktop_enriched, "share_vivo_bl", "populacao"),
        "share_claro_pos_pop_ponderado": weighted_share(desktop_enriched, "share_claro_pos", "populacao"), "share_vivo_pos_pop_ponderado": weighted_share(desktop_enriched, "share_vivo_pos", "populacao"),
        "xpto_lojas": int(stores["is_xpto"].sum()), "senhas_emitidas_agosto": int(len(senha)), "senhas_atendidas_agosto": int(senha["atendida"].sum()),
        "senhas_canceladas_agosto": int((~senha["atendida"]).sum()), "senhas_suspeitas_agosto": int(senha["suspeita_menos_1min"].sum()),
        "fluxo_atendimentos_agosto": safe_int(fluxo["fluxo_atendimentos"].sum()), "desktop_base_zero": int((desktop_enriched["base_desktop"] == 0).sum()),
        "pindorama_share_desktop_nulo": int(desktop_enriched["share_desktop"].isna().sum()), "lojas_validar_senhas": int((stores["acao_operacional"] == "VALIDAR PROCESSO DE SENHAS").sum()),
    }

    mismatch = desktop[desktop["atuacao_aa"].fillna(-1).astype(int) != desktop["ibge"].isin(aa_codes).astype(int)]
    quality = {
        "checks": {
            "base_aa_rows": int(len(aa)), "base_desktop_rows": int(len(desktop)), "base_geral_rows": int(len(general)), "base_vivo_rows": int(len(vivo)),
            "aa_unique_pdv": int(aa["pdv"].nunique()), "aa_unique_ibge": int(aa["ibge"].nunique()), "desktop_unique_ibge": int(desktop["ibge"].nunique()),
            "vivo_unique_ibge": int(vivo["ibge"].nunique()), "general_unique_ibge": int(general["ibge"].nunique()), "desktop_atuacao_aa_mismatch": int(len(mismatch)),
            "desktop_missing_general": int((~desktop["ibge"].isin(general["ibge"])).sum()), "aa_missing_general": int((~aa["ibge"].isin(general["ibge"])).sum()),
            "vivo_missing_general": int((~vivo["ibge"].isin(general["ibge"])).sum()), "desktop_share_null": int(desktop["share_desktop"].isna().sum()),
            "desktop_base_zero": int((desktop["base_desktop"].fillna(0) == 0).sum()),
            "senha_rows": int(len(senha)), "senha_store_matches": int(stores["senhas_emitidas"].notna().sum()), "senha_store_unmatched": int(stores["senhas_emitidas"].isna().sum()),
            "fluxo_rows_valid": int(len(fluxo)), "fluxo_store_matches": int(stores["fluxo_atendimentos"].notna().sum()), "fluxo_store_unmatched": int(stores["fluxo_atendimentos"].isna().sum()),
        },
        "issues": {
            "share_desktop_null_rows": desktop_enriched[desktop_enriched["share_desktop"].isna()][["municipio", "ibge", "base_desktop", "status_cobertura"]].to_dict(orient="records"),
            "base_desktop_zero_rows": desktop_enriched[desktop_enriched["base_desktop"] == 0][["municipio", "ibge", "share_desktop", "status_cobertura"]].to_dict(orient="records"),
            "xpto_stores": stores[stores["is_xpto"]][["pdv", "cidade", "ibge", "conceito", "localidade", "media_produtividade"]].to_dict(orient="records"),
            "stores_without_senha": stores[stores["senhas_emitidas"].isna()][["pdv", "cidade", "grupo"]].to_dict(orient="records"),
            "stores_without_fluxo": stores[stores["fluxo_atendimentos"].isna()][["pdv", "cidade", "grupo"]].to_dict(orient="records"),
        },
        "method": [
            "IBGE e a chave principal entre BASE_AA, BASE_DESKTOP, BASE_VIVO e BASE_GERAL.",
            "Populacao, shares locais e tecnologias usam BASE_GERAL no grao municipal.",
            "Presenca de loja AA usa BASE_AA; presenca de loja Vivo usa BASE_VIVO; lojas Desktop usam LOJA_DESKTOP.",
            "Shares BL e POS continuam pertencendo a cidade analisada, mesmo quando nao existe loja da operadora.",
            "Distancias usam Haversine entre centroides municipais e nao representam rota rodoviaria.",
            "Clusters usam cidades Desktop sem AA no quartil superior de distancia e conexoes de ate 35 km entre centroides.",
            "Contexto regional do cluster lista cidades AA e Vivo a ate 75 km de qualquer cidade integrante.",
        ],
    }

    top = {
        "cidades_sem_aa_por_base": noaa.sort_values("base_desktop", ascending=False).head(25).to_dict(orient="records"),
        "cidades_com_aa_por_base": withaa.sort_values("base_desktop", ascending=False).head(25).to_dict(orient="records"),
        "cidades_sem_vivo_por_base": desktop_enriched[~desktop_enriched["tem_loja_vivo"]].sort_values("base_desktop", ascending=False).head(25).to_dict(orient="records"),
        "receptores_por_base_sem_aa": receptors.sort_values("base_desktop_sem_aa", ascending=False).head(25).to_dict(orient="records"),
        "cidades_mais_distantes": noaa.sort_values("distancia_receptor_km", ascending=False).head(25).to_dict(orient="records"),
        "maiores_shares_sem_aa": noaa.sort_values("share_desktop", ascending=False).head(25).to_dict(orient="records"),
    }
    payload = {
        "summary": summary, "coverageSegments": coverage_segments, "desktopCities": desktop_enriched.to_dict(orient="records"),
        "generalCities": general_rows, "aaCities": aa_cities.to_dict(orient="records"), "vivoCities": vivo_cities.to_dict(orient="records"),
        "aaStores": stores.to_dict(orient="records"), "receptors": receptors.to_dict(orient="records"),
        "impactGroups": impact_groups.to_dict(orient="records"), "clusterCandidates": cluster_candidates, "top": top, "quality": quality,
    }

    write_payload_parts(payload)
    desktop_enriched.to_csv(DATA_DIR / "municipios_desktop_enriquecidos.csv", index=False, encoding="utf-8-sig")
    aa_cities.to_csv(DATA_DIR / "cidades_aa.csv", index=False, encoding="utf-8-sig")
    vivo_cities.to_csv(DATA_DIR / "cidades_vivo.csv", index=False, encoding="utf-8-sig")
    receptors.to_csv(DATA_DIR / "receptores_aa.csv", index=False, encoding="utf-8-sig")
    stores.to_csv(DATA_DIR / "lojas_aa.csv", index=False, encoding="utf-8-sig")
    pd.DataFrame([{key: value for key, value in cluster.items() if key not in ["members", "nearbyAa", "nearbyVivo"]} for cluster in cluster_candidates]).to_csv(DATA_DIR / "clusters.csv", index=False, encoding="utf-8-sig")
    with (DATA_DIR / "data_quality.json").open("w", encoding="utf-8") as stream:
        json.dump(serialise(quality), stream, ensure_ascii=False, indent=2)
    print(json.dumps(serialise({"summary": summary, "quality": quality["checks"]}), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Atualiza o dashboard Desktop, Canal AA e Vivo.")
    parser.add_argument("--config")
    parser.add_argument("--source-dir")
    arguments = parser.parse_args()
    main(config_path=arguments.config, source_dir=arguments.source_dir)
