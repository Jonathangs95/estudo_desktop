from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd


SOURCE = Path(r"C:\OneDrive - Claro SA\Jonathan\Desktop\ESTUDO_DESKTOP_OUTPUT\input_ESTUDO_DESKTOP_V3xlsx.xlsx")


def numeric(value):
    return pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0]


aa = pd.read_excel(SOURCE, sheet_name="BASE_AA")
desktop = pd.read_excel(SOURCE, sheet_name="BASE_DESKTOP")
general = pd.read_excel(SOURCE, sheet_name="BASE_GERAL")
vivo = pd.read_excel(SOURCE, sheet_name="BASE_VIVO")

aa_ibge = pd.to_numeric(aa.iloc[:, 3], errors="coerce").dropna().astype(int)
desktop_ibge = pd.to_numeric(desktop.iloc[:, 3], errors="coerce").dropna().astype(int)
general_ibge = pd.to_numeric(general.iloc[:, 0], errors="coerce").dropna().astype(int)
vivo_ibge = pd.to_numeric(vivo.iloc[:, 0], errors="coerce").dropna().astype(int)

aa_codes = set(aa_ibge)
desktop_codes = set(desktop_ibge)
general_codes = set(general_ibge)
vivo_codes = set(vivo_ibge)

rows = []
for ibge in sorted(desktop_codes):
    desktop_row = desktop.loc[desktop_ibge.index[desktop_ibge == ibge]].iloc[0]
    general_row = general.loc[general_ibge.index[general_ibge == ibge]].iloc[0] if ibge in general_codes else None
    rows.append(
        {
            "ibge": ibge,
            "cidade": str(desktop_row.iloc[0]),
            "aa": ibge in aa_codes,
            "vivo": ibge in vivo_codes,
            "base": numeric(desktop_row.iloc[9]),
            "pop": numeric(general_row.iloc[5]) if general_row is not None else np.nan,
            "desktop_share": numeric(desktop_row.iloc[8]),
            "claro_bl": numeric(general_row.iloc[9]) if general_row is not None else np.nan,
            "vivo_bl": numeric(general_row.iloc[10]) if general_row is not None else np.nan,
            "claro_pos": numeric(general_row.iloc[12]) if general_row is not None else np.nan,
            "vivo_pos": numeric(general_row.iloc[13]) if general_row is not None else np.nan,
            "desktop_stores": numeric(desktop_row.iloc[11]),
        }
    )

city = pd.DataFrame(rows)


def segment(mask):
    frame = city[mask]
    base_weight = frame["base"].fillna(0)
    pop_weight = frame["pop"].fillna(0)
    return {
        "cities": len(frame),
        "population": int(frame["pop"].sum()),
        "base_desktop": int(frame["base"].sum()),
        "desktop_stores": int(frame["desktop_stores"].sum()),
        "share_desktop_weighted": float((frame["desktop_share"] * base_weight).sum() / base_weight.sum()),
        "share_claro_bl_weighted": float((frame["claro_bl"] * base_weight).sum() / base_weight.sum()),
        "share_vivo_bl_weighted": float((frame["vivo_bl"] * base_weight).sum() / base_weight.sum()),
        "share_claro_pos_pop_weighted": float((frame["claro_pos"] * pop_weight).sum() / pop_weight.sum()),
        "share_vivo_pos_pop_weighted": float((frame["vivo_pos"] * pop_weight).sum() / pop_weight.sum()),
    }


all_rows = city.index == city.index
result = {
    "counts": {
        "aa_rows": len(aa),
        "aa_cities": len(aa_codes),
        "desktop_cities": len(desktop_codes),
        "vivo_rows": len(vivo),
        "vivo_cities": len(vivo_codes),
        "vivo_stores": int(pd.to_numeric(vivo.iloc[:, 2], errors="coerce").sum()),
        "general_cities": len(general_codes),
        "desktop_store_cities": int((city["desktop_stores"] > 0).sum()),
        "desktop_stores": int(city["desktop_stores"].sum()),
    },
    "desktop_segments": {
        "all": segment(all_rows),
        "aa_yes": segment(city["aa"]),
        "aa_no": segment(~city["aa"]),
        "vivo_yes": segment(city["vivo"]),
        "vivo_no": segment(~city["vivo"]),
        "both": segment(city["aa"] & city["vivo"]),
        "aa_only": segment(city["aa"] & ~city["vivo"]),
        "vivo_only": segment(~city["aa"] & city["vivo"]),
        "neither": segment(~city["aa"] & ~city["vivo"]),
    },
    "missing": {
        "desktop_not_general": sorted(desktop_codes - general_codes),
        "desktop_pop_null": int(city["pop"].isna().sum()),
        "desktop_share_null": int(city["desktop_share"].isna().sum()),
    },
    "aa_nonnumeric": {
        str(column): int(pd.to_numeric(aa[column], errors="coerce").isna().sum() - aa[column].isna().sum())
        for column in [aa.columns[23], aa.columns[24], aa.columns[26], aa.columns[27], aa.columns[28]]
    },
}

print(json.dumps(result, ensure_ascii=False, indent=2))
