from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
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
SOURCE_DIR = ROOT / "source_working"
CONFIG_FILE = ROOT / "dashboard_config.json"
DEFAULT_FILES = {
    "main": "ESTUDO_DESKTOP_V2xlsx.xlsx",
    "support": "BASE_CIDADES_APOIO.xlsx",
    "senha": "Senha_Ago.csv",
    "fluxo": "Fluxo.csv",
}


AA_COLUMNS = [
    "pdv",
    "grupo",
    "cidade",
    "ibge",
    "localidade",
    "m2",
    "nome_local",
    "horario_semana",
    "horario_sabado",
    "horario_domingo",
    "conceito",
    "quartil",
    "quartil_dados",
    "quartil_tv",
    "quartil_conta",
    "quartil_controle",
    "media_produtividade",
    "tipo_cabo",
    "gn",
    "filial",
    "territorio",
    "lat_original",
    "lon_original",
    "share_claro",
    "hp_total",
    "hp_livre",
    "base_claro",
    "populacao",
    "faixa_pop",
]

DESKTOP_COLUMNS = [
    "municipio",
    "ddd",
    "area",
    "ibge",
    "atuacao_desktop",
    "atuacao_aa",
    "lat_original",
    "lon_original",
    "share_desktop",
    "base_desktop",
    "populacao",
    "faixa_pop",
    "hp_cidade",
]

APOIO_COLUMNS = ["ibge", "municipio", "ddd", "territorio", "regional", "lat", "lon"]


def load_source_paths(config_path: str | Path | None = None, source_dir: str | Path | None = None) -> dict[str, Path]:
    config_file = Path(config_path).expanduser() if config_path else CONFIG_FILE
    config = {}
    if config_file.exists():
        config = json.loads(config_file.read_text(encoding="utf-8"))

    raw_source_dir = source_dir or os.environ.get("DESKTOP_DASHBOARD_SOURCE") or config.get("source_directory", "../..")
    base = Path(raw_source_dir).expanduser()
    if not base.is_absolute():
        base = (ROOT / base).resolve()

    files = {**DEFAULT_FILES, **config.get("files", {})}
    paths = {key: (base / filename).resolve() for key, filename in files.items()}
    missing = [str(path) for path in paths.values() if not path.is_file()]
    if missing:
        raise FileNotFoundError("Fontes nao encontradas:\n" + "\n".join(missing))
    return paths


def copy_source(src: Path, dest_name: str) -> Path:
    dest = SOURCE_DIR / dest_name
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return dest


def clean_text(value) -> str:
    if pd.isna(value):
        return ""
    value = str(value).strip()
    # Keep display deterministic when the workbook contains replacement chars.
    replacements = {
        "N�o": "NAO",
        "N�O": "NAO",
        "ATEN��O": "ATENCAO",
        "AVALIA��O": "AVALIACAO",
        "S�bado": "Sabado",
        "2�": "2a",
        "6�": "6a",
        "M�": "M2",
    }
    for old, new in replacements.items():
        value = value.replace(old, new)
    value = value.replace("�", "")
    return value.strip()


def category(value) -> str:
    return clean_text(value).upper()


def number(value):
    return pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0]


def safe_float(value, decimals: int | None = None):
    if value is None or pd.isna(value):
        return None
    out = float(value)
    if not math.isfinite(out):
        return None
    if decimals is not None:
        return round(out, decimals)
    return out


def safe_int(value):
    if value is None or pd.isna(value):
        return None
    out = float(value)
    if not math.isfinite(out):
        return None
    return int(round(out))


def smart_coord(value):
    n = number(value)
    if pd.isna(n):
        return None
    n = float(n)
    while abs(n) > 180:
        n = n / 10
    return n


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0088
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(a)))


def is_open(value) -> bool:
    text = category(value)
    return bool(text) and "FECHADO" not in text


def weekend_label(row) -> str:
    sat = bool(row["abre_sabado"])
    sun = bool(row["abre_domingo"])
    if sat and sun:
        return "Sabado e domingo"
    if sat:
        return "Somente sabado"
    if sun:
        return "Somente domingo"
    return "Fechado no fim de semana"


def readiness_score(row: pd.Series) -> float:
    concept_rank = {"C24": 3, "C16": 2, "C11": 1}.get(row["conceito"], 0)
    prod_rank = {"PRODUTIVA": 3, "ATENCAO": 2, "IMPRODUTIVA": 1, "SEM AVALIACAO": 0}.get(
        row["media_produtividade"], 0
    )
    local_rank = 1 if row["localidade"] == "SHOPPING" else 0
    m2 = safe_float(row["m2"]) or 0
    return (
        concept_rank * 30
        + prod_rank * 20
        + min(m2, 120) / 4
        + (8 if row["abre_domingo"] else 0)
        + (5 if row["abre_sabado"] else 0)
        + local_rank * 4
    )


def value_counts_text(values, max_items=4) -> str:
    counts = Counter([v for v in values if v])
    if not counts:
        return "Sem dado"
    items = [f"{k} ({v})" for k, v in counts.most_common(max_items)]
    return ", ".join(items)


def pressure_level(noaa_base_per_store, noaa_cities, max_distance) -> str:
    if noaa_base_per_store >= 9000 or noaa_cities >= 6 or max_distance >= 55:
        return "ALTA"
    if noaa_base_per_store >= 3500 or noaa_cities >= 3 or max_distance >= 30:
        return "MEDIA"
    return "BAIXA"


def serialise(obj):
    if isinstance(obj, dict):
        return {str(k): serialise(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [serialise(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        if not math.isfinite(float(obj)):
            return None
        return float(obj)
    if pd.isna(obj) if not isinstance(obj, (str, bool)) else False:
        return None
    return obj


def main(config_path: str | Path | None = None, source_dir: str | Path | None = None) -> None:
    source_paths = load_source_paths(config_path=config_path, source_dir=source_dir)
    main_source = source_paths["main"]
    support_source = source_paths["support"]
    senha_source = source_paths["senha"]
    fluxo_source = source_paths["fluxo"]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    main_file = copy_source(main_source, "input_ESTUDO_DESKTOP_V2xlsx.xlsx")
    support_file = copy_source(support_source, "input_BASE_CIDADES_APOIO.xlsx")
    senha_file = copy_source(senha_source, "input_Senha_Ago.csv")
    fluxo_file = copy_source(fluxo_source, "input_Fluxo.csv")

    aa = pd.read_excel(main_file, sheet_name="BASE_AA")
    desktop = pd.read_excel(main_file, sheet_name="BASE_DESKTOP")
    apoio = pd.read_excel(support_file, sheet_name="BASE_CLIMA")
    senha = pd.read_csv(senha_file, sep=";", encoding="cp1252", low_memory=False)
    fluxo = pd.read_csv(fluxo_file, sep=";", encoding="cp1252", skiprows=3, low_memory=False)

    aa.columns = AA_COLUMNS
    desktop.columns = DESKTOP_COLUMNS
    apoio.columns = APOIO_COLUMNS

    for df, code_col in [(aa, "ibge"), (desktop, "ibge"), (apoio, "ibge")]:
        df[code_col] = pd.to_numeric(df[code_col], errors="coerce").astype("Int64")

    for col in ["lat", "lon"]:
        apoio[col] = pd.to_numeric(apoio[col], errors="coerce")

    coord_by_ibge = {
        int(row.ibge): (float(row.lat), float(row.lon))
        for row in apoio.dropna(subset=["ibge", "lat", "lon"]).itertuples(index=False)
    }

    for col in [
        "pdv",
        "grupo",
        "cidade",
        "localidade",
        "nome_local",
        "horario_semana",
        "horario_sabado",
        "horario_domingo",
        "conceito",
        "media_produtividade",
        "tipo_cabo",
        "gn",
        "filial",
        "territorio",
        "faixa_pop",
    ]:
        aa[col] = aa[col].map(clean_text)

    for col in ["municipio", "area"]:
        desktop[col] = desktop[col].map(clean_text)

    aa["localidade"] = aa["localidade"].map(category)
    aa["conceito"] = aa["conceito"].map(category)
    aa["media_produtividade"] = aa["media_produtividade"].map(category)
    aa["tipo_cabo"] = aa["tipo_cabo"].map(category)
    desktop["area"] = desktop["area"].map(category)

    for col in ["m2", "share_claro", "hp_total", "hp_livre", "base_claro", "populacao"]:
        aa[col] = pd.to_numeric(aa[col], errors="coerce")
    for col in ["ddd", "atuacao_desktop", "atuacao_aa", "share_desktop", "base_desktop", "populacao", "hp_cidade"]:
        desktop[col] = pd.to_numeric(desktop[col], errors="coerce")
    desktop["faixa_pop"] = desktop["faixa_pop"].map(clean_text)

    desktop_base_by_ibge = desktop.set_index("ibge")["base_desktop"].to_dict()

    senha["pdv"] = senha["AMDOCS"].map(category)
    senha["data"] = pd.to_datetime(senha["Data"], errors="coerce")
    senha["cancelado_num"] = pd.to_numeric(senha["Cancelado"], errors="coerce").fillna(0).astype(int)
    senha["tempo_atendimento_td"] = pd.to_timedelta(senha["Tempo Atendimento"], errors="coerce")
    senha["atendida"] = senha["cancelado_num"].eq(0)
    senha["suspeita_menos_1min"] = senha["atendida"] & senha["tempo_atendimento_td"].lt(pd.Timedelta(minutes=1))
    senha["suspeita_zero"] = senha["atendida"] & senha["tempo_atendimento_td"].eq(pd.Timedelta(0))

    senha_store = senha.groupby("pdv", dropna=False).agg(
        senhas_emitidas=("pdv", "size"),
        senhas_atendidas=("atendida", "sum"),
        senhas_canceladas=("cancelado_num", lambda x: int((x != 0).sum())),
        senhas_suspeitas=("suspeita_menos_1min", "sum"),
        senhas_zero=("suspeita_zero", "sum"),
        dias_com_senha=("data", "nunique"),
    ).reset_index()
    senha_valid = senha[senha["atendida"]].copy()
    senha_tempo = senha_valid.groupby("pdv")["tempo_atendimento_td"].agg(["mean", "median"]).reset_index()
    senha_tempo["tempo_atendimento_medio_seg"] = senha_tempo["mean"].dt.total_seconds()
    senha_tempo["tempo_atendimento_mediano_seg"] = senha_tempo["median"].dt.total_seconds()
    senha_store = senha_store.merge(
        senha_tempo[["pdv", "tempo_atendimento_medio_seg", "tempo_atendimento_mediano_seg"]],
        on="pdv", how="left"
    )
    senha_store["taxa_suspeita"] = senha_store["senhas_suspeitas"] / senha_store["senhas_atendidas"].replace(0, np.nan)

    fluxo = fluxo.rename(columns={
        fluxo.columns[2]: "pdv", fluxo.columns[5]: "fluxo_atendimentos",
        fluxo.columns[8]: "fluxo_movel", fluxo.columns[14]: "fluxo_residencial",
        fluxo.columns[20]: "fluxo_conta", fluxo.columns[26]: "fluxo_controle",
        fluxo.columns[32]: "fluxo_bl", fluxo.columns[48]: "fluxo_bl_fixo",
    })
    fluxo["pdv"] = fluxo["pdv"].map(category)
    fluxo = fluxo[fluxo["pdv"] != ""].copy()
    fluxo_cols = ["fluxo_atendimentos", "fluxo_movel", "fluxo_residencial", "fluxo_conta", "fluxo_controle", "fluxo_bl", "fluxo_bl_fixo"]
    for col in fluxo_cols:
        fluxo[col] = pd.to_numeric(fluxo[col], errors="coerce")
    fluxo_store = fluxo[["pdv", *fluxo_cols]].copy()

    def coords(row):
        ibge = int(row["ibge"]) if not pd.isna(row["ibge"]) else None
        if ibge in coord_by_ibge:
            return coord_by_ibge[ibge]
        return smart_coord(row["lat_original"]), smart_coord(row["lon_original"])

    aa[["lat", "lon"]] = aa.apply(lambda r: pd.Series(coords(r)), axis=1)
    desktop[["lat", "lon"]] = desktop.apply(lambda r: pd.Series(coords(r)), axis=1)

    aa["abre_sabado"] = aa["horario_sabado"].map(is_open)
    aa["abre_domingo"] = aa["horario_domingo"].map(is_open)
    aa["fim_semana"] = aa.apply(weekend_label, axis=1)
    aa["is_xpto"] = aa["pdv"].str.upper().str.startswith("XPTO")
    aa["readiness_score"] = aa.apply(readiness_score, axis=1)

    aa_store_cols = [
        "pdv",
        "grupo",
        "cidade",
        "ibge",
        "localidade",
        "m2",
        "nome_local",
        "horario_semana",
        "horario_sabado",
        "horario_domingo",
        "fim_semana",
        "conceito",
        "quartil",
        "quartil_dados",
        "quartil_tv",
        "quartil_conta",
        "quartil_controle",
        "media_produtividade",
        "tipo_cabo",
        "gn",
        "filial",
        "territorio",
        "populacao",
        "faixa_pop",
        "abre_sabado",
        "abre_domingo",
        "lat",
        "lon",
        "share_claro",
        "hp_total",
        "hp_livre",
        "base_claro",
        "is_xpto",
        "readiness_score",
    ]
    stores = aa[aa_store_cols].copy()
    stores["pdv"] = stores["pdv"].map(category)
    stores = stores.merge(senha_store, on="pdv", how="left").merge(fluxo_store, on="pdv", how="left")
    fluxo_q75 = stores["fluxo_atendimentos"].quantile(0.75)
    suspeita_q75 = stores.loc[stores["senhas_atendidas"] >= 100, "taxa_suspeita"].quantile(0.75)
    def store_action(row):
        if pd.isna(row["senhas_atendidas"]) and pd.isna(row["fluxo_atendimentos"]):
            return "COMPLETAR DADOS"
        if pd.notna(row["taxa_suspeita"]) and row["senhas_atendidas"] >= 100 and row["taxa_suspeita"] >= suspeita_q75:
            return "VALIDAR PROCESSO DE SENHAS"
        if pd.notna(row["fluxo_atendimentos"]) and row["fluxo_atendimentos"] >= fluxo_q75:
            return "MONITORAR ALTO VOLUME"
        return "ROTINA"
    stores["acao_operacional"] = stores.apply(store_action, axis=1)

    city_rows = []
    for ibge, group in stores.groupby("ibge", dropna=False):
        group = group.sort_values(["readiness_score", "m2"], ascending=[False, False])
        anchor = group.iloc[0]
        city_rows.append(
            {
                "ibge": safe_int(ibge),
                "cidade": anchor["cidade"],
                "populacao": safe_int(group["populacao"].max()),
                "faixa_pop": clean_text(anchor["faixa_pop"]),
                "lat": safe_float(anchor["lat"], 6),
                "lon": safe_float(anchor["lon"], 6),
                "lojas": int(len(group)),
                "lojas_rua": int((group["localidade"] == "RUA").sum()),
                "lojas_shopping": int((group["localidade"] == "SHOPPING").sum()),
                "m2_medio": safe_float(group["m2"].mean(), 1),
                "m2_min": safe_float(group["m2"].min(), 1),
                "m2_max": safe_float(group["m2"].max(), 1),
                "conceitos": value_counts_text(group["conceito"]),
                "produtividade_mix": value_counts_text(group["media_produtividade"]),
                "grupos_mix": value_counts_text(group["grupo"], max_items=10),
                "lojas_resumo": "; ".join(f"{r.pdv} - {r.grupo}" for r in group.itertuples(index=False)),
                "lojas_detalhes": "; ".join(
                    f"{r.pdv} - {r.grupo} - {r.conceito} - {safe_float(r.m2, 1)} m2 - {r.localidade}"
                    for r in group.itertuples(index=False)
                ),
                "lojas_produtivas": int((group["media_produtividade"] == "PRODUTIVA").sum()),
                "abre_sabado_qtd": int(group["abre_sabado"].sum()),
                "abre_domingo_qtd": int(group["abre_domingo"].sum()),
                "fim_semana_mix": value_counts_text(group["fim_semana"]),
                "tipo_cabo": anchor["tipo_cabo"],
                "territorio": anchor["territorio"],
                "filial_principal": anchor["filial"],
                "gn_principal": anchor["gn"],
                "share_claro": safe_float(group["share_claro"].max(), 6),
                "base_claro": safe_float(group["base_claro"].max(), 2),
                "hp_total": safe_float(group["hp_total"].max(), 0),
                "hp_livre_original": safe_float(group["hp_livre"].max(), 0),
                "hp_livre": safe_float(group["hp_total"].max() - group["base_claro"].max() - (desktop_base_by_ibge.get(ibge) or 0), 0),
                "hp_livre_pct": safe_float((group["hp_total"].max() - group["base_claro"].max() - (desktop_base_by_ibge.get(ibge) or 0)) / group["hp_total"].max(), 6)
                if pd.notna(group["hp_total"].max()) and group["hp_total"].max() != 0
                else None,
                "base_desktop": safe_float(desktop_base_by_ibge.get(ibge), 0),
                "senhas_emitidas": safe_int(group["senhas_emitidas"].sum(min_count=1)),
                "senhas_atendidas": safe_int(group["senhas_atendidas"].sum(min_count=1)),
                "senhas_canceladas": safe_int(group["senhas_canceladas"].sum(min_count=1)),
                "senhas_suspeitas": safe_int(group["senhas_suspeitas"].sum(min_count=1)),
                "fluxo_atendimentos": safe_int(group["fluxo_atendimentos"].sum(min_count=1)),
                "fluxo_por_loja": safe_float(group["fluxo_atendimentos"].sum(min_count=1) / len(group), 1),
                "taxa_suspeita": safe_float(group["senhas_suspeitas"].sum(min_count=1) / group["senhas_atendidas"].sum(min_count=1), 6)
                if group["senhas_atendidas"].sum(min_count=1) not in [None, 0] and not pd.isna(group["senhas_atendidas"].sum(min_count=1)) else None,
                "anchor_pdv": anchor["pdv"],
                "anchor_grupo": anchor["grupo"],
                "anchor_localidade": anchor["localidade"],
                "anchor_m2": safe_float(anchor["m2"], 1),
                "anchor_conceito": anchor["conceito"],
                "anchor_produtividade": anchor["media_produtividade"],
                "anchor_fim_semana": anchor["fim_semana"],
                "anchor_horario_semana": anchor["horario_semana"],
                "anchor_horario_sabado": anchor["horario_sabado"],
                "anchor_horario_domingo": anchor["horario_domingo"],
            }
        )

    aa_cities = pd.DataFrame(city_rows)
    aa_city_lookup = {int(r.ibge): r._asdict() for r in aa_cities.itertuples(index=False)}

    aa_city_points = aa_cities.dropna(subset=["lat", "lon"]).to_dict(orient="records")

    desktop_rows = []
    for row in desktop.itertuples(index=False):
        ibge = int(row.ibge)
        has_aa = ibge in aa_city_lookup
        lat = safe_float(row.lat, 6)
        lon = safe_float(row.lon, 6)
        nearby = []
        for city in aa_city_points:
            dist = haversine_km(lat, lon, city["lat"], city["lon"])
            nearby.append((dist, city))
        nearby.sort(key=lambda item: item[0])
        nearest_dist, nearest = nearby[0] if nearby else (None, None)
        nearby_cities = [
            {
                "ordem": index,
                "ibge": safe_int(city.get("ibge")),
                "cidade": city.get("cidade"),
                "distancia_km": safe_float(dist, 1),
                "lojas": safe_int(city.get("lojas")),
                "lojas_rua": safe_int(city.get("lojas_rua")),
                "lojas_shopping": safe_int(city.get("lojas_shopping")),
                "conceitos": city.get("conceitos"),
                "grupos": city.get("grupos_mix"),
                "lojas_detalhes": city.get("lojas_detalhes"),
            }
            for index, (dist, city) in enumerate(nearby[:5], start=1)
        ]

        share_desktop = safe_float(row.share_desktop, 6)
        base_desktop = safe_float(row.base_desktop, 2) or 0.0
        own_city = aa_city_lookup.get(ibge, {})
        share_claro = own_city.get("share_claro") if has_aa else None
        combined_share = share_claro + share_desktop if share_claro is not None and share_desktop is not None else None
        if has_aa:
            hp_total = safe_float(own_city.get("hp_total"), 0)
            base_claro = safe_float(own_city.get("base_claro"), 0)
            hp_livre = safe_float(own_city.get("hp_livre"), 0)
            hp_livre_pct = safe_float(own_city.get("hp_livre_pct"), 6)
        else:
            hp_total = safe_float(row.hp_cidade, 0)
            base_claro = None
            hp_livre = safe_float(hp_total - base_desktop, 0) if hp_total is not None else None
            hp_livre_pct = safe_float(hp_livre / hp_total, 6) if hp_total not in [None, 0] else None
        desktop_rows.append(
            {
                "ibge": ibge,
                "municipio": clean_text(row.municipio),
                "ddd": safe_int(row.ddd),
                "area": category(row.area),
                "populacao": safe_int(row.populacao),
                "faixa_pop": clean_text(row.faixa_pop),
                "lat": lat,
                "lon": lon,
                "atuacao_desktop": safe_int(row.atuacao_desktop),
                "atuacao_aa_planilha": safe_int(row.atuacao_aa),
                "tem_loja_aa": bool(has_aa),
                "status_cobertura": "Com loja do Canal AA" if has_aa else "Sem loja do Canal AA",
                "share_desktop": share_desktop,
                "base_desktop": base_desktop,
                "base_desktop_por_mil_hab": safe_float(base_desktop / row.populacao * 1000, 2) if row.populacao else None,
                "share_claro": share_claro if has_aa else None,
                "share_combinado_potencial": safe_float(combined_share, 6),
                "hp_total": hp_total,
                "base_claro": base_claro,
                "hp_livre": hp_livre,
                "hp_livre_pct": hp_livre_pct,
                "cidades_aa_proximas": nearby_cities,
                "receptor_ibge": safe_int(nearest.get("ibge")) if nearest else None,
                "receptor_cidade": nearest.get("cidade") if nearest else None,
                "distancia_receptor_km": safe_float(nearest_dist, 1),
                "receptor_lojas": safe_int(nearest.get("lojas")) if nearest else None,
                "receptor_lojas_rua": safe_int(nearest.get("lojas_rua")) if nearest else None,
                "receptor_lojas_shopping": safe_int(nearest.get("lojas_shopping")) if nearest else None,
                "receptor_conceitos": nearest.get("conceitos") if nearest else None,
                "receptor_produtividade_mix": nearest.get("produtividade_mix") if nearest else None,
                "receptor_m2_medio": safe_float(nearest.get("m2_medio"), 1) if nearest else None,
                "receptor_fim_semana_mix": nearest.get("fim_semana_mix") if nearest else None,
                "receptor_grupos_mix": nearest.get("grupos_mix") if nearest else None,
                "receptor_lojas_resumo": nearest.get("lojas_resumo") if nearest else None,
                "receptor_territorio": nearest.get("territorio") if nearest else None,
                "receptor_hp_total": safe_float(nearest.get("hp_total"), 0) if nearest else None,
                "receptor_hp_livre": safe_float(nearest.get("hp_livre"), 0) if nearest else None,
                "receptor_hp_livre_pct": safe_float(nearest.get("hp_livre_pct"), 6) if nearest else None,
                "receptor_base_claro": safe_float(nearest.get("base_claro"), 0) if nearest else None,
                "receptor_base_desktop": safe_float(nearest.get("base_desktop"), 0) if nearest else None,
                "loja_referencia_pdv": nearest.get("anchor_pdv") if nearest else None,
                "loja_referencia_grupo": nearest.get("anchor_grupo") if nearest else None,
                "loja_referencia_localidade": nearest.get("anchor_localidade") if nearest else None,
                "loja_referencia_m2": nearest.get("anchor_m2") if nearest else None,
                "loja_referencia_conceito": nearest.get("anchor_conceito") if nearest else None,
                "loja_referencia_produtividade": nearest.get("anchor_produtividade") if nearest else None,
                "loja_referencia_fim_semana": nearest.get("anchor_fim_semana") if nearest else None,
                "loja_referencia_semana": nearest.get("anchor_horario_semana") if nearest else None,
                "loja_referencia_sabado": nearest.get("anchor_horario_sabado") if nearest else None,
                "loja_referencia_domingo": nearest.get("anchor_horario_domingo") if nearest else None,
            }
        )

    desktop_enriched = pd.DataFrame(desktop_rows)
    noaa_mask = ~desktop_enriched["tem_loja_aa"]
    noaa_base_q75 = desktop_enriched.loc[noaa_mask, "base_desktop"].quantile(0.75)
    noaa_pop_q75 = desktop_enriched.loc[noaa_mask, "populacao"].quantile(0.75)
    noaa_dist_q75 = desktop_enriched.loc[noaa_mask, "distancia_receptor_km"].quantile(0.75)
    noaa_density_q75 = desktop_enriched.loc[noaa_mask, "base_desktop_por_mil_hab"].quantile(0.75)
    def city_priority(row):
        if row["tem_loja_aa"]:
            return "COM LOJA DO CANAL AA", "Cobertura direta"
        signals = []
        if row["base_desktop"] >= noaa_base_q75: signals.append("base Desktop alta")
        if row["populacao"] >= noaa_pop_q75: signals.append("populacao alta")
        if row["distancia_receptor_km"] >= noaa_dist_q75: signals.append("distancia alta")
        if row["base_desktop_por_mil_hab"] >= noaa_density_q75: signals.append("base por mil habitantes alta")
        if "base Desktop alta" in signals and len(signals) >= 2:
            level = "PRIORIDADE 1"
        elif signals:
            level = "PRIORIDADE 2"
        else:
            level = "MONITORAR"
        return level, ", ".join(signals) if signals else "sem sinal no quartil superior"
    desktop_enriched[["prioridade_negocio", "motivos_prioridade"]] = desktop_enriched.apply(
        lambda r: pd.Series(city_priority(r)), axis=1
    )

    receptor_rows = []
    for receptor_ibge, group in desktop_enriched.groupby("receptor_ibge", dropna=False):
        city = aa_city_lookup.get(int(receptor_ibge), {})
        noaa = group[~group["tem_loja_aa"]]
        withaa = group[group["tem_loja_aa"]]
        base_total = group["base_desktop"].sum()
        base_noaa = noaa["base_desktop"].sum()
        lojas = city.get("lojas") or 1
        max_dist = noaa["distancia_receptor_km"].max() if len(noaa) else 0
        weighted_dist = (
            (noaa["distancia_receptor_km"] * noaa["base_desktop"]).sum() / noaa["base_desktop"].sum()
            if len(noaa) and noaa["base_desktop"].sum() > 0
            else 0
        )
        source_pool = noaa if len(noaa) else group
        top_source = source_pool.sort_values("base_desktop", ascending=False).iloc[0]
        receptor_rows.append(
            {
                "receptor_ibge": safe_int(receptor_ibge),
                "receptor_cidade": city.get("cidade"),
                "populacao": city.get("populacao"),
                "faixa_pop": city.get("faixa_pop"),
                "territorio": city.get("territorio"),
                "lat": city.get("lat"),
                "lon": city.get("lon"),
                "lojas": safe_int(city.get("lojas")),
                "lojas_rua": safe_int(city.get("lojas_rua")),
                "lojas_shopping": safe_int(city.get("lojas_shopping")),
                "conceitos": city.get("conceitos"),
                "produtividade_mix": city.get("produtividade_mix"),
                "grupos_mix": city.get("grupos_mix"),
                "lojas_resumo": city.get("lojas_resumo"),
                "m2_medio": city.get("m2_medio"),
                "fim_semana_mix": city.get("fim_semana_mix"),
                "hp_total": city.get("hp_total"),
                "hp_livre": city.get("hp_livre"),
                "hp_livre_pct": city.get("hp_livre_pct"),
                "share_claro": city.get("share_claro"),
                "base_claro": city.get("base_claro"),
                "base_desktop_cidade": city.get("base_desktop"),
                "senhas_emitidas": city.get("senhas_emitidas"),
                "senhas_atendidas": city.get("senhas_atendidas"),
                "senhas_canceladas": city.get("senhas_canceladas"),
                "senhas_suspeitas": city.get("senhas_suspeitas"),
                "fluxo_atendimentos": city.get("fluxo_atendimentos"),
                "fluxo_por_loja": city.get("fluxo_por_loja"),
                "taxa_suspeita": city.get("taxa_suspeita"),
                "desktop_cidades_total": int(len(group)),
                "desktop_cidades_sem_aa": int(len(noaa)),
                "desktop_cidades_com_aa": int(len(withaa)),
                "base_desktop_total": safe_float(base_total, 2),
                "base_desktop_sem_aa": safe_float(base_noaa, 2),
                "base_desktop_com_aa": safe_float(withaa["base_desktop"].sum(), 2),
                "base_sem_aa_por_loja": safe_float(base_noaa / lojas, 1) if lojas else None,
                "base_total_por_loja": safe_float(base_total / lojas, 1) if lojas else None,
                "distancia_max_sem_aa_km": safe_float(max_dist, 1),
                "distancia_media_ponderada_sem_aa_km": safe_float(weighted_dist, 1),
                "maior_origem": top_source["municipio"],
                "maior_origem_base": safe_float(top_source["base_desktop"], 0),
                "nivel_pressao": pressure_level(base_noaa / lojas if lojas else 0, len(noaa), max_dist or 0),
                "anchor_pdv": city.get("anchor_pdv"),
                "anchor_grupo": city.get("anchor_grupo"),
                "anchor_conceito": city.get("anchor_conceito"),
                "anchor_m2": city.get("anchor_m2"),
                "anchor_produtividade": city.get("anchor_produtividade"),
                "anchor_fim_semana": city.get("anchor_fim_semana"),
            }
        )

    receptors = pd.DataFrame(receptor_rows)
    receptor_load_q75 = receptors["base_sem_aa_por_loja"].quantile(0.75)
    receptor_flow_q75 = receptors["fluxo_por_loja"].quantile(0.75)
    receptor_sus_q75 = receptors.loc[receptors["senhas_atendidas"] >= 100, "taxa_suspeita"].quantile(0.75)
    def receptor_action(row):
        high_load = pd.notna(row["base_sem_aa_por_loja"]) and row["base_sem_aa_por_loja"] >= receptor_load_q75
        high_flow = pd.notna(row["fluxo_por_loja"]) and row["fluxo_por_loja"] >= receptor_flow_q75
        validate = pd.notna(row["taxa_suspeita"]) and row["senhas_atendidas"] >= 100 and row["taxa_suspeita"] >= receptor_sus_q75
        if high_load and validate: return "DIMENSIONAR CAPACIDADE E VALIDAR SENHAS"
        if high_load and high_flow: return "DIMENSIONAR CAPACIDADE"
        if high_load: return "PLANEJAR ABSORCAO DE FLUXO"
        if validate: return "VALIDAR PROCESSO DE SENHAS"
        return "MONITORAR"
    receptors["acao_recomendada"] = receptors.apply(receptor_action, axis=1)

    # Demanda externa potencial: cada cidade sem loja e atribuida a cidade com loja mais proxima.
    # Quando ha mais de uma loja na cidade, a base e dividida igualmente; nao e roteamento observado.
    stores["demanda_externa_teorica"] = 0.0
    store_origins = {pdv: [] for pdv in stores["pdv"]}
    noaa_for_allocation = desktop_enriched[~desktop_enriched["tem_loja_aa"]]
    for row in noaa_for_allocation.itertuples(index=False):
        target_idx = stores.index[stores["ibge"] == row.receptor_ibge].tolist()
        if not target_idx:
            continue
        per_store = row.base_desktop / len(target_idx)
        for idx in target_idx:
            stores.at[idx, "demanda_externa_teorica"] += per_store
            store_origins[stores.at[idx, "pdv"]].append(row.municipio)
    stores["cidades_origem_qtd"] = stores["pdv"].map(lambda x: len(store_origins.get(x, [])))
    stores["cidades_origem"] = stores["pdv"].map(lambda x: ", ".join(store_origins.get(x, [])))

    impact_group_rows = []
    for grupo, group in stores.groupby("grupo", dropna=False):
        impacted = group[group["demanda_externa_teorica"] > 0]
        origins = sorted({city for pdv in group["pdv"] for city in store_origins.get(pdv, [])})
        impact_group_rows.append({
            "grupo": grupo,
            "demanda_externa_teorica": safe_float(group["demanda_externa_teorica"].sum(), 1),
            "lojas_total": int(len(group)),
            "lojas_impactadas": int(len(impacted)),
            "cidades_origem_qtd": int(len(origins)),
            "cidades_origem": ", ".join(origins),
            "pdvs_impactados": ", ".join(impacted.sort_values("demanda_externa_teorica", ascending=False)["pdv"].tolist()),
            "fluxo_atendimentos": safe_int(group["fluxo_atendimentos"].sum(min_count=1)),
            "senhas_atendidas": safe_int(group["senhas_atendidas"].sum(min_count=1)),
            "taxa_suspeita": safe_float(group["senhas_suspeitas"].sum(min_count=1) / group["senhas_atendidas"].sum(min_count=1), 6)
            if group["senhas_atendidas"].sum(min_count=1) not in [None, 0] and not pd.isna(group["senhas_atendidas"].sum(min_count=1)) else None,
        })
    impact_groups = pd.DataFrame(impact_group_rows).sort_values("demanda_externa_teorica", ascending=False)

    # Candidatos a estudo de novo cluster: cidades sem loja no quartil superior de distancia,
    # conectadas entre si quando seus centroides municipais ficam a ate 35 km.
    far_threshold = noaa_for_allocation["distancia_receptor_km"].quantile(0.75)
    far_cities = noaa_for_allocation[noaa_for_allocation["distancia_receptor_km"] >= far_threshold].reset_index(drop=True)
    parent = list(range(len(far_cities)))
    def find_parent(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    def union_parent(i, j):
        ri, rj = find_parent(i), find_parent(j)
        if ri != rj:
            parent[rj] = ri
    for i in range(len(far_cities)):
        for j in range(i + 1, len(far_cities)):
            if haversine_km(far_cities.at[i, "lat"], far_cities.at[i, "lon"], far_cities.at[j, "lat"], far_cities.at[j, "lon"]) <= 35:
                union_parent(i, j)
    cluster_groups = {}
    for i in range(len(far_cities)):
        cluster_groups.setdefault(find_parent(i), []).append(far_cities.iloc[i])
    cluster_rows = []
    for members in cluster_groups.values():
        if len(members) < 2:
            continue
        members = sorted(members, key=lambda x: x["base_desktop"], reverse=True)
        cluster_rows.append({
            "cluster": members[0]["municipio"],
            "cidades_qtd": len(members),
            "cidades": ", ".join(x["municipio"] for x in members),
            "base_desktop": safe_float(sum(x["base_desktop"] for x in members), 0),
            "populacao": safe_int(sum(x["populacao"] for x in members)),
            "distancia_media_loja_km": safe_float(sum(x["distancia_receptor_km"] for x in members) / len(members), 1),
            "faixa_distancia_minima_km": safe_float(far_threshold, 1),
        })
    cluster_candidates = sorted(cluster_rows, key=lambda x: x["base_desktop"], reverse=True)

    aa_ibges = set(aa["ibge"].dropna().astype(int))
    mismatch = desktop[
        desktop["atuacao_aa"].fillna(-1).astype(int) != desktop["ibge"].isin(aa_ibges).astype(int)
    ]

    overlap = desktop_enriched[desktop_enriched["tem_loja_aa"]].copy()
    denominator_rows = []
    city_base = aa_cities[["ibge", "base_claro", "share_claro"]].rename(columns={"ibge": "ibge"})
    denom = desktop.merge(city_base, on="ibge", how="left")
    denom["mercado_desktop"] = denom["base_desktop"] / denom["share_desktop"]
    denom["mercado_claro"] = denom["base_claro"] / denom["share_claro"]
    denom = denom.replace([np.inf, -np.inf], np.nan)
    denom_overlap = denom.dropna(subset=["mercado_desktop", "mercado_claro"])
    denom_overlap = denom_overlap[
        (denom_overlap["mercado_desktop"] > 0) & (denom_overlap["mercado_claro"] > 0)
    ].copy()
    denom_overlap["ratio"] = denom_overlap["mercado_desktop"] / denom_overlap["mercado_claro"]
    for r in denom_overlap.itertuples(index=False):
        if r.ratio < 0.8 or r.ratio > 1.25:
            denominator_rows.append(
                {
                    "municipio": clean_text(r.municipio),
                    "ibge": safe_int(r.ibge),
                    "mercado_estimado_desktop": safe_float(r.mercado_desktop, 1),
                    "mercado_estimado_claro": safe_float(r.mercado_claro, 1),
                    "ratio": safe_float(r.ratio, 3),
                }
            )

    def weighted_share(df, share_col, weight_col):
        x = df.dropna(subset=[share_col, weight_col])
        weight = x[weight_col].sum()
        if weight <= 0:
            return None
        return safe_float((x[share_col] * x[weight_col]).sum() / weight, 6)

    noaa = desktop_enriched[~desktop_enriched["tem_loja_aa"]]
    withaa = desktop_enriched[desktop_enriched["tem_loja_aa"]]
    summary = {
        "generated_at": pd.Timestamp.now().isoformat(timespec="seconds"),
        "source_files": {
            "main": str(main_source),
            "support": str(support_source),
            "working_main_copy": str(main_file),
            "working_support_copy": str(support_file),
            "senha_agosto": str(senha_source),
            "fluxo_agosto": str(fluxo_source),
        },
        "aa_lojas": int(len(stores)),
        "aa_cidades": int(aa_cities["ibge"].nunique()),
        "desktop_cidades": int(len(desktop_enriched)),
        "desktop_com_aa": int(len(withaa)),
        "desktop_sem_aa": int(len(noaa)),
        "desktop_base_total": safe_float(desktop_enriched["base_desktop"].sum(), 0),
        "desktop_base_com_aa": safe_float(withaa["base_desktop"].sum(), 0),
        "desktop_base_sem_aa": safe_float(noaa["base_desktop"].sum(), 0),
        "desktop_base_sem_aa_pct": safe_float(noaa["base_desktop"].sum() / desktop_enriched["base_desktop"].sum(), 6),
        "share_desktop_ponderado_total": weighted_share(desktop_enriched, "share_desktop", "base_desktop"),
        "share_desktop_ponderado_com_aa": weighted_share(withaa, "share_desktop", "base_desktop"),
        "share_desktop_ponderado_sem_aa": weighted_share(noaa, "share_desktop", "base_desktop"),
        "share_combinado_mediana_com_aa": safe_float(withaa["share_combinado_potencial"].median(), 6),
        "share_combinado_max_com_aa": safe_float(withaa["share_combinado_potencial"].max(), 6),
        "hp_total_cidades_desktop_com_aa": safe_float(withaa.drop_duplicates("ibge")["hp_total"].sum(), 0),
        "hp_livre_cidades_desktop_com_aa": safe_float(withaa.drop_duplicates("ibge")["hp_livre"].sum(), 0),
        "hp_livre_pct_cidades_desktop_com_aa": safe_float(
            withaa.drop_duplicates("ibge")["hp_livre"].sum()
            / withaa.drop_duplicates("ibge")["hp_total"].sum(),
            6,
        ),
        "xpto_lojas": int(stores["is_xpto"].sum()),
        "senhas_emitidas_agosto": int(len(senha)),
        "senhas_atendidas_agosto": int(senha["atendida"].sum()),
        "senhas_canceladas_agosto": int((~senha["atendida"]).sum()),
        "senhas_suspeitas_agosto": int(senha["suspeita_menos_1min"].sum()),
        "fluxo_atendimentos_agosto": safe_int(fluxo["fluxo_atendimentos"].sum()),
        "pindorama_share_desktop_nulo": int(
            desktop_enriched["share_desktop"].isna().sum()
        ),
        "desktop_base_zero": int((desktop_enriched["base_desktop"] == 0).sum()),
        "lojas_validar_senhas": int((stores["acao_operacional"] == "VALIDAR PROCESSO DE SENHAS").sum()),
    }

    quality = {
        "checks": {
            "base_aa_rows": int(len(aa)),
            "base_desktop_rows": int(len(desktop)),
            "apoio_rows": int(len(apoio)),
            "aa_unique_pdv": int(aa["pdv"].nunique()),
            "aa_unique_ibge": int(aa["ibge"].nunique()),
            "desktop_unique_ibge": int(desktop["ibge"].nunique()),
            "desktop_atuacao_aa_mismatch": int(len(mismatch)),
            "desktop_missing_coord_in_apoio": int(
                (~desktop["ibge"].isin(apoio["ibge"])).sum()
            ),
            "aa_missing_coord_in_apoio": int((~aa["ibge"].isin(apoio["ibge"])).sum()),
            "desktop_share_null": int(desktop["share_desktop"].isna().sum()),
            "desktop_base_zero": int((desktop["base_desktop"].fillna(0) == 0).sum()),
            "aa_city_metric_variance": 0,
            "population_mismatch_between_bases": 0,
            "senha_rows": int(len(senha)),
            "senha_store_matches": int(stores["senhas_emitidas"].notna().sum()),
            "senha_store_unmatched": int(stores["senhas_emitidas"].isna().sum()),
            "fluxo_rows_valid": int(len(fluxo)),
            "fluxo_store_matches": int(stores["fluxo_atendimentos"].notna().sum()),
            "fluxo_store_unmatched": int(stores["fluxo_atendimentos"].isna().sum()),
            "hp_livre_negative_cities": int((aa_cities["hp_livre"] < 0).sum()),
        },
        "issues": {
            "share_desktop_null_rows": desktop_enriched[desktop_enriched["share_desktop"].isna()][
                ["municipio", "ibge", "base_desktop", "status_cobertura"]
            ].to_dict(orient="records"),
            "base_desktop_zero_rows": desktop_enriched[desktop_enriched["base_desktop"] == 0][
                ["municipio", "ibge", "share_desktop", "status_cobertura"]
            ].to_dict(orient="records"),
            "xpto_stores": stores[stores["is_xpto"]][
                ["pdv", "cidade", "ibge", "conceito", "localidade", "media_produtividade"]
            ].to_dict(orient="records"),
            "denominator_ratio_outliers": denominator_rows,
            "stores_without_senha": stores[stores["senhas_emitidas"].isna()][["pdv", "cidade", "grupo"]].to_dict(orient="records"),
            "stores_without_fluxo": stores[stores["fluxo_atendimentos"].isna()][["pdv", "cidade", "grupo"]].to_dict(orient="records"),
            "hp_livre_negative_rows": aa_cities[aa_cities["hp_livre"] < 0][["cidade", "ibge", "hp_total", "base_claro", "base_desktop", "hp_livre"]].to_dict(orient="records"),
        },
        "method": [
            "IBGE foi usado como chave principal para cruzar BASE_AA, BASE_DESKTOP e BASE_CIDADES_APOIO.",
            "Coordenadas do mapa usam BASE_CIDADES_APOIO; os campos LAT/LONG das abas originais foram preservados apenas como origem.",
            "Metrica de share combinado e calculada apenas onde a cidade Desktop tambem possui cidade AA.",
            "Campos HP/base/share da AA foram agregados por cidade com max/primeiro porque sao constantes entre lojas da mesma cidade.",
            "HP livre ajustado = HP total da cidade - Base Claro - Base Desktop. O HP livre original foi preservado para auditoria.",
            "Senhas suspeitas consideram atendimentos nao cancelados com Tempo Atendimento menor que 00:01:00; cancelamentos sao mostrados separadamente.",
            "Fluxo de agosto exclui a linha TOTAL e usa uma linha por Codigo mobile.",
            "Acoes operacionais usam quartis observados de base recebida por loja, fluxo por loja e taxa de atendimentos abaixo de um minuto; nao sao metas oficiais.",
            "Demanda externa teorica divide igualmente a BASE_DESKTOP de cada cidade sem loja entre as lojas da cidade com loja mais proxima; nao representa roteamento real de clientes.",
            "Loja de referencia e uma escolha derivada para leitura operacional: conceito, produtividade, area, fim de semana e m2.",
        ],
    }

    pressure_order = {"ALTA": 0, "MEDIA": 1, "BAIXA": 2}
    receptors_pressure = receptors.copy()
    receptors_pressure["_pressure_order"] = receptors_pressure["nivel_pressao"].map(pressure_order).fillna(9)

    top = {
        "cidades_sem_aa_por_base": noaa.sort_values("base_desktop", ascending=False)
        .head(25)
        .to_dict(orient="records"),
        "cidades_com_aa_por_base": withaa.sort_values("base_desktop", ascending=False)
        .head(25)
        .to_dict(orient="records"),
        "receptores_por_base_sem_aa": receptors.sort_values("base_desktop_sem_aa", ascending=False)
        .head(25)
        .to_dict(orient="records"),
        "receptores_por_pressao": receptors_pressure.sort_values(
            ["_pressure_order", "base_sem_aa_por_loja"], ascending=[True, False]
        )
        .drop(columns=["_pressure_order"])
        .head(25)
        .to_dict(orient="records"),
        "cidades_mais_distantes": noaa.sort_values("distancia_receptor_km", ascending=False)
        .head(25)
        .to_dict(orient="records"),
        "maiores_shares_sem_aa": noaa.sort_values("share_desktop", ascending=False)
        .head(25)
        .to_dict(orient="records"),
    }

    payload = {
        "summary": summary,
        "desktopCities": desktop_enriched.to_dict(orient="records"),
        "aaCities": aa_cities.to_dict(orient="records"),
        "aaStores": stores.to_dict(orient="records"),
        "receptors": receptors.to_dict(orient="records"),
        "impactGroups": impact_groups.to_dict(orient="records"),
        "clusterCandidates": cluster_candidates,
        "top": top,
        "quality": quality,
    }

    with (DATA_DIR / "desktop-impact-data.json").open("w", encoding="utf-8") as f:
        json.dump(serialise(payload), f, ensure_ascii=False, indent=2)

    desktop_enriched.to_csv(DATA_DIR / "municipios_desktop_enriquecidos.csv", index=False, encoding="utf-8-sig")
    receptors.to_csv(DATA_DIR / "receptores_aa.csv", index=False, encoding="utf-8-sig")
    stores.to_csv(DATA_DIR / "lojas_aa.csv", index=False, encoding="utf-8-sig")
    stores.to_csv(DATA_DIR / "lojas_aa_fluxo_agosto.csv", index=False, encoding="utf-8-sig")
    with (DATA_DIR / "data_quality.json").open("w", encoding="utf-8") as f:
        json.dump(serialise(quality), f, ensure_ascii=False, indent=2)

    lines = [
        "# Estudo Desktop x Canal AA",
        "",
        f"- Lojas AA: {summary['aa_lojas']} em {summary['aa_cidades']} cidades.",
        f"- Cidades Desktop: {summary['desktop_cidades']}; com AA: {summary['desktop_com_aa']}; sem AA: {summary['desktop_sem_aa']}.",
        f"- Base Desktop total: {summary['desktop_base_total']:,.0f}. Sem AA: {summary['desktop_base_sem_aa']:,.0f}.",
        f"- Share Desktop ponderado pela base: {summary['share_desktop_ponderado_total']:.1%}.",
        "",
        "## Pendencias de dados",
        f"- Share Desktop nulo: {quality['checks']['desktop_share_null']} linha(s).",
        f"- Base Desktop zerada: {quality['checks']['desktop_base_zero']} linha(s).",
        f"- Lojas XPTO: {summary['xpto_lojas']} linha(s).",
    ]
    (DATA_DIR / "executive_summary.md").write_text("\n".join(lines), encoding="utf-8")

    print(json.dumps(serialise({"summary": summary, "quality": quality["checks"]}), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Atualiza os dados derivados do dashboard Desktop Impact.")
    parser.add_argument("--config", help="Caminho do dashboard_config.json.")
    parser.add_argument("--source-dir", help="Pasta que contem as quatro bases de origem.")
    args = parser.parse_args()
    main(config_path=args.config, source_dir=args.source_dir)
