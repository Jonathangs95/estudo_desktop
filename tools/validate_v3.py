import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "data" / "desktop-impact-data.json").read_text(encoding="utf-8"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


summary = DATA["summary"]
cities = DATA["desktopCities"]
stores = DATA["aaStores"]

require(len(cities) == 173 == summary["desktop_cidades"], "Universo Desktop divergente")
require(sum(city["tem_loja_aa"] for city in cities) == 72, "Cobertura AA divergente")
require(sum(city["tem_loja_vivo"] for city in cities) == 86, "Cobertura Vivo divergente")
require(sum(city["tem_loja_aa"] and city["tem_loja_vivo"] for city in cities) == 64, "Intersecao AA/Vivo divergente")
require(sum(not city["tem_loja_aa"] and not city["tem_loja_vivo"] for city in cities) == 79, "Cidades sem AA/Vivo divergentes")
require(sum(city["base_desktop"] or 0 for city in cities) == 1_041_377, "Base Desktop total divergente")
require(len({city["ibge"] for city in cities}) == 173, "IBGE Desktop duplicado")
require(len(DATA["clusterCandidates"]) == 5, "Quantidade de clusters divergente")

pederneiras = next(city for city in cities if city["municipio"] == "PEDERNEIRAS")
require(pederneiras["receptor_cidade"] == "JAU", "Receptor de Pederneiras divergente")
require(pederneiras["lojas_aa"] == 0 and pederneiras["lojas_vivo"] == 1, "Presenca fisica de Pederneiras divergente")
require(abs(pederneiras["share_desktop"] - 0.571638) < 1e-9, "Share Desktop de Pederneiras divergente")

cellular_c11 = [store for store in stores if store["grupo"] == "CELLULAR.COM" and store["conceito"] == "C11"]
require(len(cellular_c11) == 11, "Filtro CELLULAR.COM + C11 deveria retornar 11 lojas")

print(json.dumps({
    "desktop_cidades": len(cities),
    "com_aa": sum(city["tem_loja_aa"] for city in cities),
    "com_vivo": sum(city["tem_loja_vivo"] for city in cities),
    "aa_e_vivo": sum(city["tem_loja_aa"] and city["tem_loja_vivo"] for city in cities),
    "sem_aa_vivo": sum(not city["tem_loja_aa"] and not city["tem_loja_vivo"] for city in cities),
    "base_desktop": sum(city["base_desktop"] or 0 for city in cities),
    "clusters": len(DATA["clusterCandidates"]),
    "cellular_c11": len(cellular_c11),
    "status": "OK",
}, ensure_ascii=False, indent=2))
