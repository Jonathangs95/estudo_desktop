(function(){
const h = React.createElement;
const Fragment = React.Fragment || "div";
const CLARO = "#DA291C";
const GREEN = "#16a34a";
const ORANGE = "#f97316";
const AMBER = "#f59e0b";
const BLUE = "#2563eb";
const VIVO = "#6d28d9";

const TABS = [
  ["exec", "◎", "Visão executiva"],
  ["mapa", "⌖", "Mapa"],
  ["competicao", "◫", "Claro x Vivo"],
  ["clusters", "◇", "Clusters"],
  ["sem-aa", "!", "Cidades sem Lojas do Canal AA"],
  ["com-aa", "✓", "Cidades com Lojas do Canal AA"],
  ["receptores", "◆", "Lojas do Canal AA"]
];

function fmt(v, digits=0){
  if(v == null || Number.isNaN(Number(v))) return "sem dado";
  return Number(v).toLocaleString("pt-BR", {maximumFractionDigits: digits, minimumFractionDigits: digits});
}
function pct(v, digits=1){
  if(v == null || Number.isNaN(Number(v))) return "sem dado";
  return (Number(v)*100).toLocaleString("pt-BR", {maximumFractionDigits: digits, minimumFractionDigits: digits}) + "%";
}
function pp(v){
  if(v == null || Number.isNaN(Number(v))) return "sem dado";
  return "+" + (Number(v)*100).toLocaleString("pt-BR", {maximumFractionDigits:1}) + " p.p.";
}
function km(v){
  if(v == null || Number.isNaN(Number(v))) return "sem dado";
  return Number(v).toLocaleString("pt-BR", {maximumFractionDigits:1}) + " km";
}
function duration(v){
  if(v == null || Number.isNaN(Number(v))) return "sem dado";
  const sec = Math.round(Number(v));
  return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
}
function esc(value){
  return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[ch]));
}
function chipClass(value){
  if(String(value||"").includes("DIMENSIONAR")) return "chip bad";
  if(String(value||"").includes("VALIDAR")) return "chip warn";
  if(value === "ALTA") return "chip bad";
  if(value === "MEDIA") return "chip warn";
  if(value === "Com loja do Canal AA" || value === "PRODUTIVA" || value === "MONITORAR ALTO VOLUME") return "chip good";
  if(value === "Sem loja do Canal AA" || value === "PRIORIDADE 1" || value === "VALIDAR PROCESSO DE SENHAS") return "chip bad";
  if(value === "PRIORIDADE 2" || value === "PLANEJAR ABSORCAO DE FLUXO") return "chip warn";
  if(value === "C24") return "chip blue";
  return "chip dark";
}
function maxBy(rows, field){
  return Math.max(1, ...rows.map(x => Number(x[field]) || 0));
}
function sortDesc(rows, field){
  return rows.slice().sort((a,b) => (Number(b[field])||0) - (Number(a[field])||0));
}
function median(values){
  const nums = values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid-1] + nums[mid]) / 2;
}
function splitList(value){
  return String(value || "").split(",").map(x=>x.trim()).filter(Boolean);
}
function groupImpactFromStores(stores){
  const groups = new Map();
  stores.forEach(store => {
    const key = store.grupo || "SEM GRUPO";
    if(!groups.has(key)) groups.set(key, {
      grupo:key, demanda_externa_teorica:0, lojas_total:0, lojas_impactadas:0,
      origens:new Set(), pdvs:[], fluxo:0, fluxoTemDado:false,
      senhas:0, suspeitas:0
    });
    const row = groups.get(key);
    const demand = Number(store.demanda_externa_teorica) || 0;
    row.demanda_externa_teorica += demand;
    row.lojas_total += 1;
    if(demand > 0){
      row.lojas_impactadas += 1;
      row.pdvs.push(store.pdv);
      splitList(store.cidades_origem).forEach(city=>row.origens.add(city));
    }
    if(store.fluxo_atendimentos != null){
      row.fluxo += Number(store.fluxo_atendimentos) || 0;
      row.fluxoTemDado = true;
    }
    row.senhas += Number(store.senhas_atendidas) || 0;
    row.suspeitas += Number(store.senhas_suspeitas) || 0;
  });
  return [...groups.values()].map(row=>({
    grupo:row.grupo,
    demanda_externa_teorica:row.demanda_externa_teorica,
    lojas_total:row.lojas_total,
    lojas_impactadas:row.lojas_impactadas,
    cidades_origem_qtd:row.origens.size,
    cidades_origem:[...row.origens].sort().join(", "),
    pdvs_impactados:row.pdvs.join(", "),
    fluxo_atendimentos:row.fluxoTemDado ? row.fluxo : null,
    senhas_atendidas:row.senhas,
    taxa_suspeita:row.senhas ? row.suspeitas / row.senhas : null
  })).sort((a,b)=>b.demanda_externa_teorica-a.demanda_externa_teorica);
}
function clustersForCities(clusters, cities){
  const byName = new Map(cities.filter(x=>!x.tem_loja_aa).map(x=>[x.municipio,x]));
  return (clusters || []).map(cluster=>{
    const members = splitList(cluster.cidades).map(name=>byName.get(name)).filter(Boolean);
    if(members.length < 2) return null;
    return {
      cluster:members[0].municipio,
      cidades_qtd:members.length,
      cidades:members.map(x=>x.municipio).join(", "),
      base_desktop:members.reduce((s,x)=>s+(Number(x.base_desktop)||0),0),
      populacao:members.reduce((s,x)=>s+(Number(x.populacao)||0),0),
      distancia_media_loja_km:members.reduce((s,x)=>s+(Number(x.distancia_receptor_km)||0),0)/members.length,
      faixa_distancia_minima_km:cluster.faixa_distancia_minima_km
    };
  }).filter(Boolean).sort((a,b)=>b.base_desktop-a.base_desktop);
}
function textMatch(item, query, stores=[]){
  if(!query) return true;
  const q = query.toUpperCase();
  const pdvs = stores
    .filter(s=>Number(s.ibge)===Number(item.receptor_ibge))
    .map(s=>s.pdv);
  return [
    item.municipio, item.receptor_cidade, item.loja_referencia_pdv, ...pdvs
  ].some(v => String(v || "").toUpperCase().includes(q));
}
function receptorMatch(item, query, stores=[]){
  if(!query) return true;
  const q = query.toUpperCase();
  const pdvs = stores
    .filter(s=>Number(s.ibge)===Number(item.receptor_ibge))
    .map(s=>s.pdv);
  return [
    item.receptor_cidade, item.anchor_pdv, ...pdvs
  ].some(v => String(v || "").toUpperCase().includes(q));
}


const AUTH_SESSION_KEY = "canal_aa_authenticated";

class LoginScreen extends React.Component {
  constructor(props){
    super(props);
    this.state = {usuario:"", senha:"", error:""};
    this.submit = this.submit.bind(this);
  }
  submit(e){
    e.preventDefault();
    const {usuario, senha} = this.state;
    if(usuario === "canal_aa" && senha === "canal_aa"){
      try { sessionStorage.setItem(AUTH_SESSION_KEY, "1"); } catch(_err){}
      this.setState({error:""}, this.props.onLogin);
      return;
    }
    this.setState({error:"Login ou senha incorretos."});
  }
  render(){
    const {usuario, senha, error} = this.state;
    return h("div", {className:"login-page"},
      h("section", {className:"login-card"},
        h("div", {className:"login-brand"},
          h("div", {className:"login-brand-badge"}, "AA"),
          h("span", {className:"login-eyebrow"}, "Canal AA SPI"),
          h("h1", null, "Estudo Desktop"),
          h("p", null, "Ambiente de análise de cobertura, mercado e oportunidades do Canal AA."),
          h("div", {className:"login-brand-line"})
        ),
        h("div", {className:"login-form-wrap"},
          h("div", {className:"login-form-head"},
            h("span", {className:"login-eyebrow"}, "Acesso restrito"),
            h("h2", null, "Entrar no relatório"),
            h("p", null, "Informe seu usuário e senha para acessar a visão principal.")
          ),
          h("form", {className:"login-form", onSubmit:this.submit},
            h("label", null,
              h("span", null, "Usuário"),
              h("input", {
                type:"text",
                value:usuario,
                onChange:e=>this.setState({usuario:e.target.value}),
                autoComplete:"username",
                autoFocus:true,
                placeholder:"Digite seu usuário"
              })
            ),
            h("label", null,
              h("span", null, "Senha"),
              h("input", {
                type:"password",
                value:senha,
                onChange:e=>this.setState({senha:e.target.value}),
                autoComplete:"current-password",
                placeholder:"Digite sua senha"
              })
            ),
            error ? h("div", {className:"login-error", role:"alert"}, error) : null,
            h("button", {type:"submit", className:"login-submit"}, "Acessar relatório")
          ),
          h("small", {className:"login-footnote"}, "Uso interno • Canal AA")
        )
      )
    );
  }
}

function Sidebar({active, setActive, onLogout}){
  return h("aside", {className:"sidebar"},
    h("div", {className:"brand"},
      h("div", null, h("b", null, "Estudo Desktop - Canal AA"), h("span", null, "Canal AA SPI"))
    ),
    h("nav", {className:"nav"},
      ...TABS.map(([id, icon, label]) =>
        h("button", {key:id, className: active === id ? "active" : "", onClick:()=>setActive(id)},
          h("i", null, icon), h("span", null, label)
        )
      )
    ),
    h("div", {className:"sidebar-session"},
      h("div", null, h("b", null, "Canal AA"), h("span", null, "Sessão autenticada")),
      h("button", {type:"button", onClick:onLogout, title:"Sair"}, "Sair")
    )
  );
}

function PageHead({active}){
  const title = TABS.find(x => x[0] === active)?.[2] || "Estudo";
  return h("div", {className:"page-head"},
    h("h1", null, title)
  );
}

function FilterStrip({data, filters, setFilters, active}){
  const aaCityView = active === "com-aa";
  const areas = [...new Set(data.desktopCities.map(x => x.area).filter(Boolean))].sort();
  const territorios = [...new Set(data.receptors.map(x => x.territorio).filter(Boolean))].sort();
  const layouts = [...new Set(data.aaStores.map(x => x.conceito).filter(Boolean))].sort();
  const grupos = [...new Set(data.aaStores.map(x => x.grupo).filter(Boolean))].sort();
  const faixaOrder = ["Acima de 300k", "De 100k a 299k", "De 50k a 99k", "De 30k a 49k"];
  const faixas = [...new Set(data.desktopCities.map(x => x.faixa_pop).filter(Boolean))].sort((a,b) => {
    const ai = faixaOrder.indexOf(a), bi = faixaOrder.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const update = patch => setFilters({...filters, ...patch});
  return h("div", {className:"filter-strip" + (aaCityView ? " aa-city-filters" : "")},
    h("label", null, h("span", null, "Busca"), h("input", {value:filters.search, onChange:e=>update({search:e.target.value}), placeholder:"Cidade ou PDV"})),
    !aaCityView ? h("label", null, h("span", null, "Cobertura"), h("select", {value:filters.coverage, onChange:e=>update({coverage:e.target.value})},
      h("option", {value:"Todos"}, "Todas"),
      h("option", {value:"Sem loja do Canal AA"}, "Sem loja do Canal AA"),
      h("option", {value:"Com loja do Canal AA"}, "Com loja do Canal AA")
    )) : null,
    h("label", null, h("span", null, "Loja Vivo"), h("select", {value:filters.vivoPresence, onChange:e=>update({vivoPresence:e.target.value})},
      h("option", {value:"Todos"}, "Com ou sem loja"),
      h("option", {value:"Com loja Vivo"}, "Com loja Vivo"),
      h("option", {value:"Sem loja Vivo"}, "Sem loja Vivo")
    )),
    !aaCityView ? h("label", null, h("span", null, "Loja Desktop"), h("select", {value:filters.desktopPresence, onChange:e=>update({desktopPresence:e.target.value})},
      h("option", {value:"Todos"}, "Com ou sem loja"),
      h("option", {value:"Com loja Desktop"}, "Com loja Desktop"),
      h("option", {value:"Sem loja Desktop"}, "Sem loja Desktop")
    )) : null,
    !aaCityView ? h("label", null, h("span", null, "TIPO"), h("select", {value:filters.area, onChange:e=>update({area:e.target.value})},
      h("option", {value:"Todos"}, "Todas"), ...areas.map(x => h("option", {key:x, value:x}, x))
    )) : null,
    h("label", null, h("span", null, "Faixa POP"), h("select", {value:filters.faixaPop, onChange:e=>update({faixaPop:e.target.value})},
      h("option", {value:"Todos"}, "Todas"), ...faixas.map(x => h("option", {key:x, value:x}, x))
    )),
    h("label", null, h("span", null, "Territorio"), h("select", {value:filters.territorio, onChange:e=>update({territorio:e.target.value})},
      h("option", {value:"Todos"}, "Todos"), ...territorios.map(x => h("option", {key:x, value:x}, x))
    )),
    h("label", null, h("span", null, "Layout"), h("select", {value:filters.layout, onChange:e=>update({layout:e.target.value})},
      h("option", {value:"Todos"}, "Todos"), ...layouts.map(x => h("option", {key:x, value:x}, x))
    )),
    h("label", null, h("span", null, "Grupo"), h("select", {value:filters.grupo, onChange:e=>update({grupo:e.target.value})},
      h("option", {value:"Todos"}, "Todos"), ...grupos.map(x => h("option", {key:x, value:x}, x))
    )),
    h("label", null, h("span", null, "Loja AA"), h("select", {value:filters.localidade, onChange:e=>update({localidade:e.target.value})},
      h("option", {value:"Todos"}, "Rua ou shopping"),
      h("option", {value:"RUA"}, "Rua"),
      h("option", {value:"SHOPPING"}, "Shopping")
    )),
    h("button", {onClick:()=>setFilters(defaultFilters())}, "Limpar")
  );
}

function defaultFilters(){
  return {search:"", coverage:"Todos", vivoPresence:"Todos", desktopPresence:"Todos", area:"Todos", faixaPop:"Todos", territorio:"Todos", layout:"Todos", grupo:"Todos", localidade:"Todos"};
}

function storeDimensionMatch(store, filters){
  if(filters.territorio !== "Todos" && store.territorio !== filters.territorio) return false;
  if(filters.layout !== "Todos" && store.conceito !== filters.layout) return false;
  if(filters.grupo !== "Todos" && store.grupo !== filters.grupo) return false;
  if(filters.localidade !== "Todos" && store.localidade !== filters.localidade) return false;
  return true;
}

function applyCityFilters(data, filters){
  const hasStoreFilter = [filters.territorio, filters.layout, filters.grupo, filters.localidade].some(x=>x !== "Todos");
  return data.desktopCities.filter(item => {
    if(filters.coverage !== "Todos" && item.status_cobertura !== filters.coverage) return false;
    if(filters.vivoPresence === "Com loja Vivo" && !item.tem_loja_vivo) return false;
    if(filters.vivoPresence === "Sem loja Vivo" && item.tem_loja_vivo) return false;
    if(filters.desktopPresence === "Com loja Desktop" && !item.tem_loja_desktop) return false;
    if(filters.desktopPresence === "Sem loja Desktop" && item.tem_loja_desktop) return false;
    if(filters.area !== "Todos" && item.area !== filters.area) return false;
    if(filters.faixaPop !== "Todos" && item.faixa_pop !== filters.faixaPop) return false;
    if(hasStoreFilter && !data.aaStores.some(s=>Number(s.ibge)===Number(item.ibge) && storeDimensionMatch(s,filters))) return false;
    return textMatch(item, filters.search, data.aaStores);
  });
}
function applyReceptorFilters(data, filters){
  const hasStoreFilter = [filters.territorio, filters.layout, filters.grupo, filters.localidade].some(x=>x !== "Todos");
  return data.receptors.filter(item => {
    if(filters.faixaPop !== "Todos" && item.faixa_pop !== filters.faixaPop) return false;
    const desktopCity=data.desktopCities.find(city=>Number(city.ibge)===Number(item.receptor_ibge));
    const generalCity=data.generalCities.find(city=>Number(city.ibge)===Number(item.receptor_ibge));
    if(filters.vivoPresence === "Com loja Vivo" && !(desktopCity?.tem_loja_vivo || generalCity?.tem_loja_vivo)) return false;
    if(filters.vivoPresence === "Sem loja Vivo" && (desktopCity?.tem_loja_vivo || generalCity?.tem_loja_vivo)) return false;
    if(hasStoreFilter && !data.aaStores.some(s=>Number(s.ibge)===Number(item.receptor_ibge) && storeDimensionMatch(s,filters))) return false;
    return receptorMatch(item, filters.search, data.aaStores);
  });
}
function applyStoreFilters(data, filters){
  const q = filters.search.toUpperCase();
  return data.aaStores.filter(item => {
    if(filters.faixaPop !== "Todos" && item.faixa_pop !== filters.faixaPop) return false;
    const city=data.generalCities.find(row=>Number(row.ibge)===Number(item.ibge));
    if(filters.vivoPresence === "Com loja Vivo" && !city?.tem_loja_vivo) return false;
    if(filters.vivoPresence === "Sem loja Vivo" && city?.tem_loja_vivo) return false;
    if(!storeDimensionMatch(item,filters)) return false;
    if(q && ![item.pdv,item.cidade].some(v=>String(v||"").toUpperCase().includes(q))) return false;
    return true;
  });
}

function valueMix(rows, field){
  return [...new Set(rows.map(x=>x[field]).filter(Boolean))]
    .sort((a,b)=>String(a).localeCompare(String(b),"pt-BR"))
    .map(value=>`${value} (${rows.filter(x=>x[field]===value).length})`)
    .join(", ") || "sem dado";
}

function buildAaCities(stores, data){
  const desktopByIbge=new Map(data.desktopCities.map(c=>[Number(c.ibge),c]));
  const generalByIbge=new Map((data.generalCities||[]).map(c=>[Number(c.ibge),c]));
  const aaMasterByIbge=new Map((data.aaCities||[]).map(c=>[Number(c.ibge),c]));
  const grouped=new Map();
  stores.forEach(store=>{
    const key=Number(store.ibge);
    if(!grouped.has(key)) grouped.set(key,[]);
    grouped.get(key).push(store);
  });
  return [...grouped.entries()].map(([ibge,members])=>{
    const first=members[0];
    const desktop=desktopByIbge.get(ibge);
    const general=generalByIbge.get(ibge)||{};
    const aaMaster=aaMasterByIbge.get(ibge)||{};
    const validM2=members.map(s=>Number(s.m2)).filter(Number.isFinite);
    return {
      ibge,
      cidade:first.cidade,
      populacao:Number(first.populacao),
      faixa_pop:first.faixa_pop,
      territorio:first.territorio,
      lat:Number(first.lat),
      lon:Number(first.lon),
      lojas:members.length,
      lojas_rua:members.filter(s=>s.localidade==="RUA").length,
      lojas_shopping:members.filter(s=>s.localidade==="SHOPPING").length,
      pdvs:members.map(s=>s.pdv).join(", "),
      lojas_resumo:members.map(s=>`${s.pdv} (${s.localidade}, ${s.conceito})`).join(" | "),
      conceitos:valueMix(members,"conceito"),
      produtividade_mix:valueMix(members,"media_produtividade"),
      grupos_mix:valueMix(members,"grupo"),
      m2_medio:validM2.length ? validM2.reduce((sum,x)=>sum+x,0)/validM2.length : null,
      base_claro:aaMaster.base_claro,
      share_claro:aaMaster.share_claro,
      base_desktop:desktop ? desktop.base_desktop : null,
      share_desktop:desktop ? desktop.share_desktop : null,
      tem_desktop:Boolean(desktop),
      lojas_vivo:Number(general.lojas_vivo)||0,
      tem_loja_vivo:Boolean(general.tem_loja_vivo),
      share_claro_bl:general.share_claro_bl,
      share_vivo_bl:general.share_vivo_bl,
      share_claro_pos:general.share_claro_pos,
      share_vivo_pos:general.share_vivo_pos,
      tecnologia_claro:general.tecnologia_claro,
      tecnologia_vivo:general.tecnologia_vivo,
      stores:members
    };
  }).sort((a,b)=>b.lojas-a.lojas || String(a.cidade).localeCompare(String(b.cidade),"pt-BR"));
}

function Kpi({label, value, note, color="red"}){
  return h("div", {className:"kpi-card " + color},
    h("span", null, label),
    h("strong", null, value),
    h("small", null, note)
  );
}

function PanoramaKpis({cities}){
  const noaa = cities.filter(x => !x.tem_loja_aa);
  const withaa = cities.filter(x => x.tem_loja_aa);
  const withVivo = cities.filter(x => x.tem_loja_vivo);
  const withoutVivo = cities.filter(x => !x.tem_loja_vivo);
  const both = cities.filter(x => x.tem_loja_aa && x.tem_loja_vivo);
  const neither = cities.filter(x => !x.tem_loja_aa && !x.tem_loja_vivo);
  const base = cities.reduce((s,x)=>s + (Number(x.base_desktop)||0), 0);
  return h("div", {className:"kpi-grid"},
    h(Kpi, {label:"Cidades Desktop", value:fmt(cities.length), note:"Universo de atuação filtrado", color:"red"}),
    h(Kpi, {label:"Cidades Desktop com AA", value:fmt(withaa.length), note:`${fmt(noaa.length)} cidades Desktop sem loja`, color:"green"}),
    h(Kpi, {label:"Cidades Desktop com Vivo", value:fmt(withVivo.length), note:`${fmt(withoutVivo.length)} cidades sem loja Vivo`, color:"violet"}),
    h(Kpi, {label:"AA + Vivo", value:fmt(both.length), note:`${fmt(neither.length)} cidades sem loja AA/Vivo`, color:"amber"}),
    h(Kpi, {label:"Base Desktop", value:fmt(base), note:`População ${fmt(cities.reduce((s,x)=>s+(Number(x.populacao)||0),0))}`, color:"blue"})
  );
}

function weighted(rows, valueField, weightField="populacao"){
  let value=0, weight=0;
  rows.forEach(row=>{
    const v=Number(row[valueField]);
    const w=Number(row[weightField]);
    if(Number.isFinite(v) && Number.isFinite(w) && w>0){ value+=v*w; weight+=w; }
  });
  return weight ? value/weight : null;
}

function CoverageMatrix({cities}){
  const definitions=[
    ["AA + Vivo",c=>c.tem_loja_aa&&c.tem_loja_vivo,"both"],
    ["Somente AA",c=>c.tem_loja_aa&&!c.tem_loja_vivo,"aa"],
    ["Somente Vivo",c=>!c.tem_loja_aa&&c.tem_loja_vivo,"vivo"],
    ["Sem loja AA/Vivo",c=>!c.tem_loja_aa&&!c.tem_loja_vivo,"none"]
  ];
  return h("section",{className:"card context-card"},
    h("div",{className:"card-head"},h("div",null,h("h3",null,"Presença física nas cidades Desktop"),h("p",null,"Quatro grupos exclusivos. Share não implica existência de loja."))),
    h("div",{className:"coverage-matrix"},...definitions.map(([label,test,cls])=>{
      const rows=cities.filter(test);
      return h("div",{className:`coverage-cell ${cls}`,key:label},
        h("div",null,h("b",null,label),h("strong",null,fmt(rows.length))),
        h("span",null,`${fmt(rows.reduce((s,x)=>s+(Number(x.populacao)||0),0))} habitantes`),
        h("span",null,`${fmt(rows.reduce((s,x)=>s+(Number(x.base_desktop)||0),0))} base Desktop`),
        h("small",null,`Share Desktop ${pct(weighted(rows,"share_desktop","base_desktop"))}`)
      );
    }))
  );
}

function ShareBar({label,value,color}){
  return h("div",{className:"share-row"},
    h("div",null,h("span",null,label),h("b",null,pct(value))),
    h("div",{className:"share-track"},h("i",{style:{width:`${Math.max(0,Math.min(100,(Number(value)||0)*100))}%`,background:color}}))
  );
}

function CompetitiveShares({cities}){
  return h("section",{className:"card context-card"},
    h("div",{className:"card-head"},h("div",null,h("h3",null,"Participação de mercado"),h("p",null,"BL e pós ponderados pela população das cidades filtradas."))),
    h("div",{className:"share-groups"},
      h("div",null,h("h4",null,"Banda larga"),h(ShareBar,{label:"Claro",value:weighted(cities,"share_claro_bl"),color:CLARO}),h(ShareBar,{label:"Vivo",value:weighted(cities,"share_vivo_bl"),color:VIVO}),h(ShareBar,{label:"Desktop",value:weighted(cities,"share_desktop"),color:ORANGE})),
      h("div",null,h("h4",null,"Pós-pago"),h(ShareBar,{label:"Claro",value:weighted(cities,"share_claro_pos"),color:CLARO}),h(ShareBar,{label:"Vivo",value:weighted(cities,"share_vivo_pos"),color:VIVO}))
    )
  );
}

function PopulationPanel({cities, activeFaixa, onFaixaSelect}){
  const order=["Acima de 300k","De 100k a 299k","De 50k a 99k","De 30k a 49k","Ate 29K","Até 29K"];
  const rows=order.map(f=>{
    const x=cities.filter(c=>c.faixa_pop===f);
    return {faixa:f,cidades:x.length,base:x.reduce((s,c)=>s+(Number(c.base_desktop)||0),0),comLoja:x.filter(c=>c.tem_loja_aa).length};
  }).filter(x=>x.cidades);
  const max=Math.max(1,...rows.map(x=>x.cidades));
  return h("section", {className:"card context-card"},
    h("div", {className:"card-head"}, h("div", null, h("h3", null, "Perfil populacional das cidades Desktop"), h("p", null, "Quantidade de cidades, cobertura do Canal AA e base Desktop por faixa."))),
    h("div", {className:"population-list"}, ...rows.map(r=>h("button", {
      className:"population-row" + (activeFaixa===r.faixa ? " active" : ""),
      key:r.faixa,
      onClick:()=>onFaixaSelect(r.faixa),
      "aria-label":`Filtrar ${r.faixa}`,
      "aria-pressed":activeFaixa===r.faixa
    },
      h("div", null,h("b",null,r.faixa),h("span",null,
        r.comLoja === r.cidades
          ? `Todas as ${fmt(r.cidades)} cidades possuem loja AA`
          : `${fmt(r.comLoja)} cidades com loja AA | ${fmt(r.cidades-r.comLoja)} cidades sem loja AA`
      )),
      h("div",{className:"population-bar"},h("i",{style:{width:(r.cidades/max*100)+"%"}})),
      h("strong",null,fmt(r.cidades)),h("small",null,`${fmt(r.base)} base`)
    )))
  );
}

function StoreFootprint({stores}){
  const rua=stores.filter(s=>s.localidade==="RUA").length;
  const shopping=stores.filter(s=>s.localidade==="SHOPPING").length;
  const productive=stores.filter(s=>s.media_produtividade==="PRODUTIVA").length;
  const cityCount=new Set(stores.map(s=>Number(s.ibge)).filter(Number.isFinite)).size;
  const storesPerCity=cityCount ? stores.length/cityCount : null;
  const concepts=[...new Set(stores.map(s=>s.conceito).filter(Boolean))].map(c=>`${c} (${stores.filter(s=>s.conceito===c).length})`).join(" | ");
  const groups=[...new Set(stores.map(s=>s.grupo).filter(Boolean))];
  const productivity=[...new Set(stores.map(s=>s.media_produtividade).filter(Boolean))].map(c=>`${c} (${stores.filter(s=>s.media_produtividade===c).length})`).join(" | ");
  return h("section", {className:"card context-card"},
    h("div", {className:"card-head"}, h("div", null, h("h3", null, "Perfil das Lojas do Canal AA"), h("p", null, "Quantidade, capilaridade e perfil da rede filtrada."))),
    h("div", {className:"network-metrics"},
      h("div",null,h("b",null,fmt(stores.length)),h("span",null,"Lojas")),
      h("div",null,h("b",null,fmt(cityCount)),h("span",null,"Cidades com lojas AA")),
      h("div",null,h("b",null,fmt(storesPerCity,1)),h("span",null,"Lojas por cidade")),
      h("div",null,h("b",null,fmt(groups.length)),h("span",null,"Grupos")),
      h("div",null,h("b",null,`${fmt(rua)} / ${fmt(shopping)}`),h("span",null,"Rua / shopping")),
      h("div",null,h("b",null,fmt(productive)),h("span",null,"Produtivas"))
    ),
    h("div",{className:"context-notes"},
      h("div",{className:"context-note"},h("b",null,"Conceitos"),h("span",null,concepts||"sem dado")),
      h("div",{className:"context-note"},h("b",null,"Produtividade"),h("span",null,productivity||"sem dado"))
    )
  );
}

function OperationsOverview({stores}){
  const senhaStores=stores.filter(s=>s.senhas_atendidas!=null);
  const fluxoStores=stores.filter(s=>s.fluxo_atendimentos!=null);
  const atendidas=senhaStores.reduce((s,x)=>s+(Number(x.senhas_atendidas)||0),0);
  const suspeitas=senhaStores.reduce((s,x)=>s+(Number(x.senhas_suspeitas)||0),0);
  const fluxo=fluxoStores.reduce((s,x)=>s+(Number(x.fluxo_atendimentos)||0),0);
  const topSenhas=sortDesc(senhaStores,"senhas_atendidas").slice(0,5);
  const topFluxo=sortDesc(fluxoStores,"fluxo_atendimentos").slice(0,5);
  return h("section",{className:"card context-card"},
    h("div",{className:"card-head"},h("div",null,
      h("h3",null,"Operação observada em agosto/2026"),
      h("p",null,"Senhas não canceladas e atendimentos por produto; ausência de dado permanece como sem dado.")
    )),
    h("div",{className:"network-metrics operation-metrics"},
      h("div",null,h("b",null,fmt(atendidas)),h("span",null,`Senhas em ${fmt(senhaStores.length)} lojas`)),
      h("div",null,h("b",null,fmt(median(senhaStores.map(s=>s.senhas_atendidas)))),h("span",null,"Mediana de senhas por loja")),
      h("div",null,h("b",null,fmt(fluxo)),h("span",null,`Fluxo em ${fmt(fluxoStores.length)} lojas`)),
      h("div",null,h("b",null,fmt(median(fluxoStores.map(s=>s.fluxo_atendimentos)))),h("span",null,"Mediana de fluxo por loja")),
      h("div",null,h("b",null,fmt(suspeitas)),h("span",null,`${pct(atendidas?suspeitas/atendidas:null)} abaixo de 1 min`))
    ),
    h("div",{className:"operation-rankings"},
      h("div",null,h("h4",null,"Maiores volumes de senhas"),...topSenhas.map(s=>h("div",{className:"rank-line",key:"senha-"+s.pdv},h("span",null,`${s.pdv} | ${s.grupo}`),h("b",null,fmt(s.senhas_atendidas))))),
      h("div",null,h("h4",null,"Maiores fluxos por produto"),...topFluxo.map(s=>h("div",{className:"rank-line",key:"fluxo-"+s.pdv},h("span",null,`${s.pdv} | ${s.grupo}`),h("b",null,fmt(s.fluxo_atendimentos)))))
    )
  );
}

function StoreDemandList({stores, limit=8}){
  const rows=stores.filter(s=>(Number(s.demanda_externa_teorica)||0)>0).sort((a,b)=>b.demanda_externa_teorica-a.demanda_externa_teorica).slice(0,limit);
  return h("div",{className:"demand-list"},...rows.map(s=>h("div",{className:"demand-row",key:s.pdv},
    h("div",null,h("b",null,`${s.pdv} | ${s.grupo}`),h("span",null,`${s.cidade} | ${s.localidade} | ${s.conceito} | ${fmt(s.m2,1)} m²`)),
    h("div",{className:"demand-value"},h("strong",null,fmt(s.demanda_externa_teorica,1)),h("small",null,`${fmt(s.cidades_origem_qtd)} cidades`)),
    h("p",null,s.cidades_origem)
  )));
}

class ImpactMap extends React.Component {
  constructor(props){
    super(props);
    this.host = null;
    this.map = null;
    this.layer = null;
  }
  componentDidMount(){
    this.initMap();
    this.renderLayer();
  }
  componentDidUpdate(){
    this.renderLayer();
  }
  initMap(){
    if(!this.host || !window.L || this.map) return;
    this.map = L.map(this.host, {zoomControl:true, preferCanvas:true});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);
  }
  renderLayer(){
    if(!this.map || !window.L) return;
    const {cities, receptors, aaCities, vivoCities=[], onSelect} = this.props;
    const receptorByIbge = new Map(receptors.map(r => [r.receptor_ibge, r]));
    const desktopIbges = new Set(cities.map(c=>Number(c.ibge)));
    if(this.layer) this.layer.remove();
    const group = L.layerGroup().addTo(this.map);
    this.layer = group;
    const bounds = [];
    const maxBase = maxBy(cities, "base_desktop");
    const noaaTop = sortDesc(cities.filter(x => !x.tem_loja_aa), "base_desktop").slice(0, 32);
    noaaTop.forEach(city => {
      const receptor = receptorByIbge.get(city.receptor_ibge);
      if(receptor && city.lat && city.lon && receptor.lat && receptor.lon) {
        L.polyline([[city.lat, city.lon], [receptor.lat, receptor.lon]], {
          color:"#636363", weight:1, opacity:.32, dashArray:"4 6"
        }).addTo(group);
      }
    });
    cities.forEach(city => {
      if(!city.lat || !city.lon) return;
      const color = ORANGE;
      const radius = 5 + Math.sqrt((Number(city.base_desktop)||0) / maxBase) * 13;
      const marker = L.circleMarker([city.lat, city.lon], {
        radius, color:"#fff", weight:1.6, fillColor:color, fillOpacity:.78
      }).addTo(group);
      if(city.tem_loja_aa) L.circleMarker([city.lat,city.lon],{radius:radius+3,color:CLARO,weight:2.5,fill:false,interactive:false}).addTo(group);
      if(city.tem_loja_vivo) L.circleMarker([city.lat,city.lon],{radius:radius+6,color:VIVO,weight:2.5,fill:false,interactive:false,dashArray:"4 2"}).addTo(group);
      marker.bindTooltip(
        `<div class="map-tooltip-title">${esc(city.municipio)}</div>` +
        `<span>Cidade Desktop | ${esc(city.faixa_pop)}</span>` +
        `<span>População ${fmt(city.populacao)} | Base ${fmt(city.base_desktop)}</span>` +
        `<span>AA ${fmt(city.lojas_aa)} | Vivo ${fmt(city.lojas_vivo)} | Desktop ${fmt(city.lojas_desktop)} loja(s)</span>`,
        {direction:"top", offset:[0,-4], opacity:.97, sticky:true, className:"city-map-tooltip"}
      );
      marker.bindPopup(
        `<div class="popup-title">${esc(city.municipio)}</div>` +
        `<span class="popup-line">AA ${fmt(city.lojas_aa)} | Vivo ${fmt(city.lojas_vivo)} | Desktop ${fmt(city.lojas_desktop)} loja(s)</span>` +
        `<span class="popup-line">BL: Claro ${pct(city.share_claro_bl)} | Vivo ${pct(city.share_vivo_bl)} | Desktop ${pct(city.share_desktop)}</span>` +
        `<span class="popup-line">Pós: Claro ${pct(city.share_claro_pos)} | Vivo ${pct(city.share_vivo_pos)}</span>` +
        `<span class="popup-line">Tecnologia: Claro ${esc(city.tecnologia_claro)} | Vivo ${esc(city.tecnologia_vivo)}</span>` +
        `<span class="popup-line">Distância ${km(city.distancia_receptor_km)} | Loja ${esc(city.loja_referencia_pdv)}</span>`
      );
      marker.on("click", () => onSelect({kind:"city", item:city}));
      bounds.push([city.lat, city.lon]);
    });
    aaCities.forEach(city => {
      if(!city.lat || !city.lon) return;
      if(desktopIbges.has(Number(city.ibge))) return;
      const marker = L.circleMarker([city.lat, city.lon], {
        radius:5.2, color:CLARO, weight:2, fillColor:"#fff", fillOpacity:.8
      }).addTo(group);
      marker.bindTooltip(
        `<div class="map-tooltip-title">${esc(city.cidade)}</div>` +
        `<span>Cidade com AA | ${esc(city.faixa_pop)}</span>` +
        `<span>População ${fmt(city.populacao)} | ${fmt(city.lojas)} loja(s)</span>`,
        {direction:"top", offset:[0,-4], opacity:.97, sticky:true, className:"city-map-tooltip"}
      );
      marker.bindPopup(
        `<div class="popup-title">${esc(city.cidade)}</div>` +
        `<span class="popup-line">${fmt(city.lojas)} lojas do Canal AA</span>` +
        `<span class="popup-line">${esc(city.conceitos)} | ${esc(city.grupos_mix)}</span>`
      );
      marker.on("click", () => onSelect({kind:"aa-city", item:city}));
      bounds.push([city.lat, city.lon]);
    });
    vivoCities.forEach(city=>{
      if(!city.lat || !city.lon || desktopIbges.has(Number(city.ibge))) return;
      const marker=L.circleMarker([city.lat,city.lon],{radius:5.2,color:VIVO,weight:2,fillColor:"#fff",fillOpacity:.8}).addTo(group);
      marker.bindTooltip(`<div class="map-tooltip-title">${esc(city.cidade)}</div><span>Cidade com loja Vivo | ${esc(city.faixa_pop)}</span><span>${fmt(city.lojas)} loja(s) | População ${fmt(city.populacao)}</span>`,{direction:"top",opacity:.97,sticky:true,className:"city-map-tooltip"});
      bounds.push([city.lat,city.lon]);
    });
    if(bounds.length) this.map.fitBounds(bounds, {padding:[24,24], maxZoom:9});
    setTimeout(() => this.map && this.map.invalidateSize(), 60);
  }
  render(){
    return h("div", {className:"map-wrap"},
      h("div", {className:"map-host", ref:el => { this.host = el; }}, !window.L ? h("div", {className:"map-fallback"}, "Mapa indisponível sem Leaflet") : null),
      h("div", {className:"map-legend"},
        h("span", null, h("i", {style:{background:ORANGE}}), "Cidade com Desktop"),
        h("span", null, h("i", {className:"ring-aa"}), "Cidade com AA"),
        h("span", null, h("i", {className:"ring-vivo"}), "Cidade com Vivo")
      )
    );
  }
}

class LayeredImpactMap extends React.Component {
  constructor(props){
    super(props);
    this.state={layers:{desktopCoverage:true,desktopStores:true,aaStores:true,vivoStores:true}};
    this.host=null;
    this.map=null;
    this.layer=null;
  }
  componentDidMount(){ this.initMap(); this.renderLayer(); }
  componentDidUpdate(){ this.renderLayer(); }
  initMap(){
    if(!this.host||!window.L||this.map) return;
    this.map=L.map(this.host,{zoomControl:true,preferCanvas:true});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(this.map);
  }
  toggleLayer(key){
    this.setState(state=>({layers:{...state.layers,[key]:!state.layers[key]}}));
  }
  setAll(value){
    this.setState({layers:{desktopCoverage:value,desktopStores:value,aaStores:value,vivoStores:value}});
  }
  renderLayer(){
    if(!this.map||!window.L) return;
    const {cities,receptors,aaCities,vivoCities=[],onSelect}=this.props;
    const {desktopCoverage,desktopStores,aaStores,vivoStores}=this.state.layers;
    const receptorByIbge=new Map(receptors.map(r=>[Number(r.receptor_ibge),r]));
    const desktopByIbge=new Map(cities.map(c=>[Number(c.ibge),c]));
    if(this.layer) this.layer.remove();
    const group=L.layerGroup().addTo(this.map);
    this.layer=group;
    const bounds=[];

    if(desktopCoverage&&aaStores){
      sortDesc(cities.filter(c=>!c.tem_loja_aa),"base_desktop").slice(0,32).forEach(city=>{
        const receptor=receptorByIbge.get(Number(city.receptor_ibge));
        if(receptor&&city.lat&&city.lon&&receptor.lat&&receptor.lon){
          L.polyline([[city.lat,city.lon],[receptor.lat,receptor.lon]],{color:"#636363",weight:1,opacity:.25,dashArray:"4 6",interactive:false}).addTo(group);
        }
      });
    }

    if(desktopCoverage){
      const maxBase=maxBy(cities,"base_desktop");
      cities.forEach(city=>{
        if(!city.lat||!city.lon) return;
        const radius=5+Math.sqrt((Number(city.base_desktop)||0)/maxBase)*13;
        const marker=L.circleMarker([city.lat,city.lon],{radius,color:"#fff",weight:1.4,fillColor:ORANGE,fillOpacity:.72}).addTo(group);
        marker.bindTooltip(
          `<div class="map-tooltip-title">${esc(city.municipio)}</div>`+
          `<span>Atua\u00e7\u00e3o Desktop | ${esc(city.faixa_pop)}</span>`+
          `<span>Popula\u00e7\u00e3o ${fmt(city.populacao)} | Base ${fmt(city.base_desktop)}</span>`+
          `<span>Share Desktop ${pct(city.share_desktop)}</span>`,
          {direction:"top",offset:[0,-4],opacity:.97,sticky:true,className:"city-map-tooltip"}
        );
        marker.on("click",()=>onSelect({kind:"city",item:city}));
        bounds.push([city.lat,city.lon]);
      });
    }

    if(aaStores){
      aaCities.forEach(city=>{
        if(!city.lat||!city.lon) return;
        const marker=L.circleMarker([city.lat,city.lon],{
          radius:7+Math.min(5,Math.sqrt(Number(city.lojas)||0)),color:CLARO,weight:2.5,fillColor:"#fff",fillOpacity:.06
        }).addTo(group);
        marker.bindTooltip(
          `<div class="map-tooltip-title">${esc(city.cidade)}</div>`+
          `<span>Loja Canal AA | ${esc(city.faixa_pop)}</span>`+
          `<span>Popula\u00e7\u00e3o ${fmt(city.populacao)} | ${fmt(city.lojas)} loja(s)</span>`+
          `<span>${esc(city.conceitos)} | ${esc(city.grupos_mix)}</span>`,
          {direction:"top",offset:[0,-4],opacity:.97,sticky:true,className:"city-map-tooltip"}
        );
        marker.bindPopup(
          `<div class="popup-title">${esc(city.cidade)}</div>`+
          `<span class="popup-line">${fmt(city.lojas)} lojas do Canal AA</span>`+
          `<span class="popup-line">${esc(city.lojas_detalhes||city.lojas_resumo)}</span>`
        );
        marker.on("click",()=>onSelect({kind:"aa-city",item:city}));
        bounds.push([city.lat,city.lon]);
      });
    }

    if(vivoStores){
      vivoCities.forEach(city=>{
        if(!city.lat||!city.lon) return;
        const marker=L.circleMarker([city.lat,city.lon],{
          radius:9+Math.min(5,Math.sqrt(Number(city.lojas)||0)),color:VIVO,weight:2.3,fillColor:"#fff",fillOpacity:.03,dashArray:"5 3"
        }).addTo(group);
        marker.bindTooltip(
          `<div class="map-tooltip-title">${esc(city.cidade)}</div>`+
          `<span>Loja Vivo | ${esc(city.faixa_pop)}</span>`+
          `<span>${fmt(city.lojas)} loja(s) | Popula\u00e7\u00e3o ${fmt(city.populacao)}</span>`+
          `<span>BL ${pct(city.share_vivo_bl)} | P\u00f3s ${pct(city.share_vivo_pos)}</span>`,
          {direction:"top",opacity:.97,sticky:true,className:"city-map-tooltip"}
        );
        const desktopCity=desktopByIbge.get(Number(city.ibge));
        if(desktopCity) marker.on("click",()=>onSelect({kind:"city",item:desktopCity}));
        bounds.push([city.lat,city.lon]);
      });
    }

    if(desktopStores){
      cities.filter(city=>Number(city.lojas_desktop)>0).forEach(city=>{
        if(!city.lat||!city.lon) return;
        const storeCount=Number(city.lojas_desktop)||0;
        const icon=L.divIcon({
          className:"desktop-store-pin",
          html:`<span class="desktop-store-symbol" title="${fmt(storeCount)} loja(s) Desktop"><i></i>${storeCount>1?`<b>${fmt(storeCount)}</b>`:""}</span>`,
          iconSize:[18,18],iconAnchor:[9,9]
        });
        const marker=L.marker([city.lat,city.lon],{icon,zIndexOffset:550}).addTo(group);
        marker.bindTooltip(
          `<div class="map-tooltip-title">${esc(city.municipio)}</div>`+
          `<span>Loja Desktop | ${fmt(city.lojas_desktop)} unidade(s)</span>`+
          `<span>${esc(city.faixa_pop)} | Popula\u00e7\u00e3o ${fmt(city.populacao)}</span>`+
          `<span>Base ${fmt(city.base_desktop)} | Share ${pct(city.share_desktop)}</span>`,
          {direction:"top",offset:[0,-7],opacity:.97,sticky:true,className:"city-map-tooltip"}
        );
        marker.on("click",()=>onSelect({kind:"city",item:city}));
        bounds.push([city.lat,city.lon]);
      });
    }

    if(bounds.length) this.map.fitBounds(bounds,{padding:[24,24],maxZoom:9});
    else this.map.setView([-22.45,-48.2],7);
    setTimeout(()=>this.map&&this.map.invalidateSize(),60);
  }
  render(){
    const {cities,aaCities,vivoCities=[]}=this.props;
    const layers=this.state.layers;
    const desktopStoreCities=cities.filter(c=>Number(c.lojas_desktop)>0);
    const options=[
      {group:"Desktop",key:"desktopCoverage",label:"Atua\u00e7\u00e3o Desktop",note:`${fmt(cities.length)} cidades`,swatch:"coverage"},
      {group:"Desktop",key:"desktopStores",label:"Lojas Desktop",note:`${fmt(desktopStoreCities.length)} cidades | ${fmt(desktopStoreCities.reduce((s,c)=>s+(Number(c.lojas_desktop)||0),0))} lojas`,swatch:"desktop-store"},
      {group:"Claro",key:"aaStores",label:"Lojas Canal AA",note:`${fmt(aaCities.length)} cidades | ${fmt(aaCities.reduce((s,c)=>s+(Number(c.lojas)||0),0))} lojas`,swatch:"aa"},
      {group:"Vivo",key:"vivoStores",label:"Lojas Vivo",note:`${fmt(vivoCities.length)} cidades | ${fmt(vivoCities.reduce((s,c)=>s+(Number(c.lojas)||0),0))} lojas`,swatch:"vivo"}
    ];
    return h(Fragment,null,
      h("div",{className:"map-layer-toolbar",role:"group","aria-label":"Camadas do mapa"},
        h("div",{className:"map-layer-title"},h("b",null,"Camadas do mapa"),h("span",null,"Combine atua\u00e7\u00e3o e presen\u00e7a f\u00edsica")),
        h("div",{className:"map-layer-options"},...options.map(option=>h("label",{className:`map-layer-option ${layers[option.key]?"active":""}`,key:option.key},
          h("input",{type:"checkbox",checked:layers[option.key],onChange:()=>this.toggleLayer(option.key)}),
          h("i",{className:`map-swatch ${option.swatch}`}),
          h("span",null,h("b",null,option.label),h("small",null,`${option.group} | ${option.note}`))
        ))),
        h("div",{className:"map-layer-actions"},
          h("button",{type:"button",onClick:()=>this.setAll(true)},"Todas"),
          h("button",{type:"button",onClick:()=>this.setAll(false)},"Limpar")
        )
      ),
      h("div",{className:"map-wrap"},
        h("div",{className:"map-host",ref:el=>{this.host=el;}},!window.L?h("div",{className:"map-fallback"},"Mapa indispon\u00edvel sem Leaflet"):null),
        h("div",{className:"map-legend compact"},
          layers.desktopCoverage?h("span",null,h("i",{style:{background:ORANGE}}),"Atua\u00e7\u00e3o Desktop"):null,
          layers.desktopStores?h("span",null,h("i",{className:"store-desktop"}),"Loja Desktop"):null,
          layers.aaStores?h("span",null,h("i",{className:"ring-aa"}),"Loja Canal AA"):null,
          layers.vivoStores?h("span",null,h("i",{className:"ring-vivo"}),"Loja Vivo"):null
        )
      )
    );
  }
}

function BarList({rows, labelField, valueField, noteField, color=CLARO, gradientEnd="#ffaaa2", limit=10, onSelect}){
  const top = sortDesc(rows, valueField).slice(0, limit);
  const max = maxBy(top, valueField);
  return h("div", {className:"bar-list"},
    ...top.map(row => h("div", {className:"bar-row", key:(row.ibge || row.receptor_ibge || row[labelField]) + labelField},
      h("span", null,
        onSelect ? h("button", {className:"city-button", onClick:()=>onSelect(row)}, row[labelField]) : row[labelField],
        noteField ? h("small", {className:"muted"}, row[noteField]) : null
      ),
      h("div", {className:"bar-bg"}, h("div", {className:"bar-fill", style:{width:((Number(row[valueField])||0)/max*100)+"%", background:`linear-gradient(90deg, ${color}, ${gradientEnd})`}})),
      h("b", null, fmt(row[valueField]))
    ))
  );
}

function InsightList({data}){
  const q = data.quality;
  return h("div", {className:"insight-list"},
    h("div", {className:"insight"}, h("b", null, "101 cidades Desktop não possuem loja AA"), h("span", null, "Esse é o corte pedido originalmente. O painel também mostra as 72 cidades onde Desktop e AA convivem, para medir sobrecarga local.")),
    h("div", {className:"insight"}, h("b", null, "Jaú concentra a maior base sem AA recebida"), h("span", null, "Pederneiras, Barra Bonita e outras cidades próximas somam o maior fluxo potencial no receptor Jaú.")),
    h("div", {className:"insight"}, h("b", null, "Dados a validar antes de uma versão final executiva"), h("span", null, `Share Desktop nulo em ${q.checks.desktop_share_null} cidade e BASE_DESKTOP zerada em ${q.checks.desktop_base_zero} cidade.`)),
    h("div", {className:"insight"}, h("b", null, "XPTO não foi descartado"), h("span", null, "As 3 lojas novas sem código definitivo entram na capilaridade e ficam sinalizadas no método."))
  );
}

function DecisionStrip({cities, receptors, stores}){
  const priority = cities.filter(x=>x.prioridade_negocio==="PRIORIDADE 1");
  const smallNoStore = cities.filter(x=>!x.tem_loja_aa && String(x.faixa_pop||"").includes("29K"));
  const dimension = receptors.filter(x=>String(x.acao_recomendada||"").includes("DIMENSIONAR"));
  const validate = stores.filter(x=>x.acao_operacional==="VALIDAR PROCESSO DE SENHAS");
  return h("div", {className:"decision-strip"},
    h("div", {className:"decision-card red"}, h("span", null, "Sinal de cobertura prioritária"), h("b", null, `${fmt(priority.length)} cidades`), h("small", null, `Base alta e ao menos outro indicador no quartil superior | ${fmt(priority.reduce((s,x)=>s+(Number(x.base_desktop)||0),0))} de base`)),
    h("div", {className:"decision-card green"}, h("span", null, "Cidades pequenas sem loja"), h("b", null, `${fmt(smallNoStore.length)} cidades`), h("small", null, `Até 29 mil habitantes | ${fmt(smallNoStore.reduce((s,x)=>s+(Number(x.base_desktop)||0),0))} de base Desktop`)),
    h("div", {className:"decision-card blue"}, h("span", null, "Sinal de capacidade na cidade AA"), h("b", null, `${fmt(dimension.length)} cidades`), h("small", null, "Base externa teórica por loja no quartil superior, combinada a fluxo ou senhas")),
    h("div", {className:"decision-card amber"}, h("span", null, "Sinal de processo de senhas"), h("b", null, `${fmt(validate.length)} lojas`), h("small", null, "100+ senhas atendidas e taxa abaixo de 1 minuto no quartil superior"))
  );
}

function CityOpportunityList({rows, onSelect}){
  const top = rows.slice().sort((a,b)=>{
    const order={"PRIORIDADE 1":0,"PRIORIDADE 2":1,"MONITORAR":2};
    return (order[a.prioridade_negocio]??9)-(order[b.prioridade_negocio]??9) || b.base_desktop-a.base_desktop;
  }).slice(0,10);
  return h("div", {className:"decision-list"}, ...top.map(r=>h("button", {key:r.ibge, onClick:()=>onSelect({kind:"city",item:r})},
    h("div", null, h("b", null, r.municipio), h("span", null, `${r.faixa_pop} | Pop. ${fmt(r.populacao)}`)),
    h("div", {className:"decision-values"}, h(CoverageChip,{value:r.prioridade_negocio}), h("strong", null, fmt(r.base_desktop)), h("small", null, "Base Desktop")),
    h("p", null, r.motivos_prioridade)
  )));
}

function ChannelCityList({rows, onSelect}){
  const priority = rows.filter(r=>r.acao_recomendada!=="MONITORAR").sort((a,b)=>(b.base_desktop_sem_aa||0)-(a.base_desktop_sem_aa||0)).slice(0,10);
  return h("div", {className:"decision-list"}, ...priority.map(r=>h("button", {key:r.receptor_ibge, onClick:()=>onSelect({kind:"receptor",item:r})},
    h("div", null, h("b", null, r.receptor_cidade), h("span", null, `${r.faixa_pop} | Pop. ${fmt(r.populacao)} | ${fmt(r.lojas)} loja(s)`)),
    h("div", {className:"decision-values"}, h(CoverageChip,{value:r.nivel_pressao}), h("strong", null, fmt(r.base_desktop_cidade)), h("small", null, "Base Desktop da cidade")),
    h("p", null, `${r.acao_recomendada} | ${fmt(r.base_desktop_sem_aa)} de base externa atribuída`)
  )));
}

function SectionTitle({title, text, tag}){
  return h("div", {className:"section-title"},
    h("div",null,h("h2",null,title),text?h("p",null,text):null),
    tag?h("span",{className:"section-tag"},tag):null
  );
}

function GroupImpactTable({groups, limit=8}){
  const rows=(groups||[]).filter(x=>x.demanda_externa_teorica>0).slice(0,limit);
  return h("div", {className:"compact-table"},
    h("div",{className:"compact-head"},h("span",null,"Grupo e alcance"),h("span",null,"Demanda teórica"),h("span",null,"PDVs impactados")),
    ...rows.map(r=>h("div",{className:"compact-row",key:r.grupo},
      h("div",null,h("b",null,r.grupo),h("small",null,`${fmt(r.cidades_origem_qtd)} cidades de origem | ${fmt(r.lojas_impactadas)} de ${fmt(r.lojas_total)} lojas impactadas`)),
      h("div",null,h("strong",null,fmt(r.demanda_externa_teorica,1)),h("small",null,`${fmt(r.senhas_atendidas)} senhas | ${fmt(r.fluxo_atendimentos)} fluxo`)),
      h("span",null,r.pdvs_impactados||"sem PDV"),
      h("details",{className:"compact-detail"},h("summary",null,"Ver cidades de origem"),h("p",null,r.cidades_origem||"sem cidade"))
    ))
  );
}

function ClusterList({clusters}){
  return h("div",{className:"cluster-list"},...(clusters||[]).map((r,i)=>h("div",{className:"cluster-row",key:r.cluster},
    h("div",{className:"cluster-index"},String(i+1).padStart(2,"0")),
    h("div",null,h("b",null,`${fmt(r.cidades_qtd)} cidades | ${fmt(r.base_desktop)} base Desktop`),h("span",null,r.cidades)),
    h("div",{className:"cluster-meta"},h("strong",null,km(r.distancia_media_loja_km)),h("small",null,`${fmt(r.populacao)} habitantes`))
  )));
}

function StoreImpactTable({stores, limit=20}){
  const rows=stores.filter(s=>(Number(s.demanda_externa_teorica)||0)>0).sort((a,b)=>b.demanda_externa_teorica-a.demanda_externa_teorica).slice(0,limit);
  return h("div",{className:"table-wrap store-impact-wrap"},h("table",{className:"data-table"},
    h("thead",null,h("tr",null,h("th",null,"PDV / grupo"),h("th",null,"Cidade"),h("th",null,"Demanda externa teórica"),h("th",null,"Cidades de origem"),h("th",null,"Estrutura"),h("th",null,"Operação agosto"))),
    h("tbody",null,...rows.map(s=>h("tr",{key:s.pdv},
      h("td",null,h("b",null,s.pdv),h("span",{className:"muted"},s.grupo)),
      h("td",null,h("b",null,s.cidade),h("span",{className:"muted"},s.territorio)),
      h("td",null,h("b",null,fmt(s.demanda_externa_teorica,1)),h("span",{className:"muted"},"Divisão igual entre lojas da cidade")),
      h("td",null,h("b",null,fmt(s.cidades_origem_qtd)),h("span",{className:"muted"},s.cidades_origem)),
      h("td",null,h("b",null,`${s.localidade} | ${fmt(s.m2,1)} m²`),h("span",{className:"muted"},`${s.conceito} | ${s.media_produtividade}`)),
      h("td",null,h("b",null,`${fmt(s.fluxo_atendimentos)} fluxo`),h("span",{className:"muted"},`${fmt(s.senhas_atendidas)} senhas atendidas | ${pct(s.taxa_suspeita)} < 1 min`))
    )))
  ));
}

function ExecutivePage({data, cities, receptors, aaCities, stores, filters, onFaixaSelect, onSelect}){
  return h(Fragment, null,
    h(PanoramaKpis, {cities}),
    h("div",{className:"section-grid two-grid"},
      h(CoverageMatrix,{cities}),
      h(CompetitiveShares,{cities})
    ),
    h("div",{className:"section-grid two-grid"},
      h(PopulationPanel,{cities,activeFaixa:filters.faixaPop,onFaixaSelect}),
      h(StoreFootprint,{stores})
    ),
    h(SectionTitle,{title:"Onde estão as cidades e lojas",text:"Selecione as camadas para comparar atuação Desktop e presença física de Desktop, Canal AA e Vivo.",tag:"MAPA INTERATIVO"}),
    h("div", {className:"section-grid executive-map"},
      h(LayeredImpactMap, {cities, receptors, aaCities, vivoCities:data.vivoCities, onSelect})
    )
  );
}

function MapPage({cities, receptors, aaCities, vivoCities, onSelect}){
  return h("div", {className:"section-grid"},
    h("section", {className:"card"},
      h("div", {className:"card-head"},
        h("div", null, h("h2", null, "Mapa de atuação e lojas"), h("p", null, "Combine livremente atuação Desktop, lojas Desktop, Canal AA e Vivo.")),
        h("span", {className:"pill"}, `${fmt(cities.length)} cidades filtradas`)
      ),
      h(LayeredImpactMap, {cities, receptors, aaCities, vivoCities, onSelect})
    )
  );
}

class CompetitionPage extends React.Component {
  constructor(props){ super(props); this.state={sort:"base"}; }
  render(){
    const {cities,onSelect}=this.props;
    const sort=this.state.sort;
    const rows=cities.slice().sort((a,b)=>{
      if(sort==="population") return (Number(b.populacao)||0)-(Number(a.populacao)||0);
      if(sort==="claroBl") return (Number(b.share_claro_bl)||0)-(Number(a.share_claro_bl)||0);
      if(sort==="vivoBl") return (Number(b.share_vivo_bl)||0)-(Number(a.share_vivo_bl)||0);
      if(sort==="desktopShare") return (Number(b.share_desktop)||0)-(Number(a.share_desktop)||0);
      return (Number(b.base_desktop)||0)-(Number(a.base_desktop)||0);
    });
    const vivoOnly=sortDesc(cities.filter(c=>!c.tem_loja_aa&&c.tem_loja_vivo),"base_desktop").slice(0,10);
    const neither=sortDesc(cities.filter(c=>!c.tem_loja_aa&&!c.tem_loja_vivo),"base_desktop").slice(0,10);
    return h(Fragment,null,
      h(PanoramaKpis,{cities}),
      h("div",{className:"section-grid two-grid"},
        h(CoverageMatrix,{cities}),h(CompetitiveShares,{cities})
      ),
      h("div",{className:"section-grid two-grid"},
        h("section",{className:"card"},h("div",{className:"card-head"},h("div",null,h("h3",null,"Sem AA, com loja Vivo"),h("p",null,"Maiores bases Desktop onde a concorrência já tem presença física."))),h(BarList,{rows:vivoOnly,labelField:"municipio",valueField:"base_desktop",color:VIVO,gradientEnd:"#a78bfa",limit:10,onSelect:r=>onSelect({kind:"city",item:r})})),
        h("section",{className:"card"},h("div",{className:"card-head"},h("div",null,h("h3",null,"Sem loja AA e Vivo"),h("p",null,"Maiores bases Desktop sem presença física das duas operadoras."))),h(BarList,{rows:neither,labelField:"municipio",valueField:"base_desktop",color:ORANGE,limit:10,onSelect:r=>onSelect({kind:"city",item:r})}))
      ),
      h("section",{className:"card table-card"},
        h("div",{className:"table-head"},h("div",null,h("h2",null,"Comparativo municipal completo"),h("p",null,"Presença física, shares e tecnologia no mesmo grão municipal.")),
          h("div",{className:"table-actions"},h("label",null,h("span",null,"Ordenar por"),h("select",{value:sort,onChange:e=>this.setState({sort:e.target.value})},
            h("option",{value:"base"},"Maior Base Desktop"),h("option",{value:"population"},"Maior população"),h("option",{value:"desktopShare"},"Maior Share Desktop"),h("option",{value:"claroBl"},"Maior Share Claro BL"),h("option",{value:"vivoBl"},"Maior Share Vivo BL"))),h("span",{className:"pill"},`${fmt(rows.length)} cidades`))),
        h("div",{className:"table-wrap"},h("table",{className:"data-table competition-table"},
          h("thead",null,h("tr",null,h("th",null,"Cidade"),h("th",null,"População / Base"),h("th",null,"Lojas"),h("th",null,"Share BL"),h("th",null,"Share pós"),h("th",null,"Tecnologia"),h("th",null,"TIPO"))),
          h("tbody",null,...rows.map(c=>h("tr",{key:c.ibge},
            h("td",null,h("button",{className:"city-button",onClick:()=>onSelect({kind:"city",item:c})},c.municipio),h("span",{className:"muted"},`${c.faixa_pop} | IBGE ${c.ibge}`)),
            h("td",null,h("b",null,fmt(c.populacao)),h("span",{className:"muted"},`${fmt(c.base_desktop)} base Desktop`)),
            h("td",null,h("b",null,`AA ${fmt(c.lojas_aa)} | Vivo ${fmt(c.lojas_vivo)}`),h("span",{className:"muted"},`Desktop ${fmt(c.lojas_desktop)} loja(s)`)),
            h("td",null,h("b",null,`Claro ${pct(c.share_claro_bl)} | Vivo ${pct(c.share_vivo_bl)}`),h("span",{className:"muted"},`Desktop ${pct(c.share_desktop)}`)),
            h("td",null,h("b",null,`Claro ${pct(c.share_claro_pos)}`),h("span",{className:"muted"},`Vivo ${pct(c.share_vivo_pos)}`)),
            h("td",null,h("b",null,`Claro ${c.tecnologia_claro||"sem dado"}`),h("span",{className:"muted"},`Vivo ${c.tecnologia_vivo||"sem dado"}`)),
            h("td",null,h(CoverageChip,{value:c.area}))
          )))
        ))
      )
    );
  }
}

class ClusterMap extends React.Component {
  constructor(props){ super(props); this.host=null; this.map=null; this.layer=null; }
  componentDidMount(){ this.initMap(); this.renderLayer(); }
  componentDidUpdate(){ this.renderLayer(); }
  initMap(){
    if(!this.host||!window.L||this.map) return;
    this.map=L.map(this.host,{zoomControl:true,preferCanvas:true});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(this.map);
  }
  renderLayer(){
    if(!this.map||!window.L||!this.props.cluster) return;
    const c=this.props.cluster;
    if(this.layer) this.layer.remove();
    const group=L.layerGroup().addTo(this.map); this.layer=group;
    const bounds=[];
    (c.members||[]).forEach(m=>{
      const aa=(c.nearbyAa||[]).find(x=>x.cidade===m.receptor_cidade);
      if(aa) L.polyline([[m.lat,m.lon],[aa.lat,aa.lon]],{color:CLARO,weight:1.3,opacity:.45,dashArray:"5 5"}).addTo(group);
    });
    (c.nearbyAa||[]).forEach(x=>{
      const marker=L.circleMarker([x.lat,x.lon],{radius:7,color:CLARO,weight:2.5,fillColor:"#fff",fillOpacity:.92}).addTo(group);
      marker.bindTooltip(`<div class="map-tooltip-title">${esc(x.cidade)}</div><span>Canal AA | ${fmt(x.lojas)} loja(s) | ${km(x.distancia_cluster_km)}</span><span>${esc(x.lojas_detalhes)}</span>`,{direction:"top",sticky:true,className:"city-map-tooltip"}); bounds.push([x.lat,x.lon]);
    });
    (c.nearbyVivo||[]).forEach(x=>{
      const marker=L.circleMarker([x.lat,x.lon],{radius:5.5,color:VIVO,weight:2,fillColor:"#fff",fillOpacity:.92}).addTo(group);
      marker.bindTooltip(`<div class="map-tooltip-title">${esc(x.cidade)}</div><span>Vivo | ${fmt(x.lojas)} loja(s) | ${km(x.distancia_cluster_km)}</span><span>BL ${pct(x.share_vivo_bl)} | Pós ${pct(x.share_vivo_pos)}</span>`,{direction:"top",sticky:true,className:"city-map-tooltip"}); bounds.push([x.lat,x.lon]);
    });
    (c.members||[]).forEach(m=>{
      const marker=L.circleMarker([m.lat,m.lon],{radius:9,color:"#fff",weight:2,fillColor:ORANGE,fillOpacity:.9}).addTo(group);
      if(m.lojas_desktop) L.circleMarker([m.lat,m.lon],{radius:12,color:AMBER,weight:2,fill:false,interactive:false}).addTo(group);
      if(m.lojas_vivo) L.circleMarker([m.lat,m.lon],{radius:15,color:VIVO,weight:2,fill:false,interactive:false,dashArray:"4 2"}).addTo(group);
      marker.bindTooltip(`<div class="map-tooltip-title">${esc(m.municipio)}</div><span>${fmt(m.populacao)} habitantes | ${fmt(m.base_desktop)} base</span><span>BL: Claro ${pct(m.share_claro_bl)} | Vivo ${pct(m.share_vivo_bl)} | Desktop ${pct(m.share_desktop)}</span><span>AA mais próxima: ${esc(m.receptor_cidade)} | ${km(m.distancia_receptor_km)}</span>`,{direction:"top",sticky:true,className:"city-map-tooltip"}); bounds.push([m.lat,m.lon]);
    });
    if(bounds.length) this.map.fitBounds(bounds,{padding:[28,28],maxZoom:10});
    setTimeout(()=>this.map&&this.map.invalidateSize(),60);
  }
  render(){ return h("div",{className:"map-wrap cluster-map-wrap"},h("div",{className:"map-host cluster-map-host",ref:el=>{this.host=el;}}),h("div",{className:"map-legend"},h("span",null,h("i",{style:{background:ORANGE}}),"Cidade do cluster"),h("span",null,h("i",{className:"ring-aa"}),"Canal AA"),h("span",null,h("i",{className:"ring-vivo"}),"Vivo"))); }
}

class ClustersPage extends React.Component {
  constructor(props){ super(props); this.state={selectedId:props.clusters?.[0]?.cluster_id||null}; }
  render(){
    const clusters=this.props.clusters||[];
    const cluster=clusters.find(c=>c.cluster_id===this.state.selectedId)||clusters[0];
    if(!cluster) return h("div",{className:"empty-note"},"Nenhum agrupamento identificado pelas regras atuais.");
    return h(Fragment,null,
      h("div",{className:"cluster-selector"},...clusters.map((c,i)=>h("button",{key:c.cluster_id,className:c.cluster_id===cluster.cluster_id?"active":"",onClick:()=>this.setState({selectedId:c.cluster_id})},h("small",null,`Cluster ${i+1}`),h("b",null,c.cluster),h("span",null,`${fmt(c.cidades_qtd)} cidades | ${fmt(c.base_desktop)} base`)))),
      h("div",{className:"cluster-summary"},
        h(Kpi,{label:"Cidades no cluster",value:fmt(cluster.cidades_qtd),note:cluster.tipos,color:"amber"}),
        h(Kpi,{label:"População",value:fmt(cluster.populacao),note:`Share Desktop ${pct(cluster.share_desktop)}`,color:"blue"}),
        h(Kpi,{label:"Base Desktop",value:fmt(cluster.base_desktop),note:`${fmt(cluster.lojas_desktop)} loja(s) Desktop`,color:"red"}),
        h(Kpi,{label:"Presença Vivo",value:fmt(cluster.lojas_vivo),note:`BL ${pct(cluster.share_vivo_bl)} | Pós ${pct(cluster.share_vivo_pos)}`,color:"violet"}),
        h(Kpi,{label:"Distância média ao AA",value:km(cluster.distancia_media_loja_km),note:`Mínima ${km(cluster.faixa_distancia_minima_km)}`,color:"green"})
      ),
      h("section",{className:"card cluster-map-card"},h("div",{className:"card-head"},h("div",null,h("h2",null,`Região de ${cluster.cluster}`),h("p",null,"Cidades agrupadas e rede física no entorno. Linhas indicam a cidade AA mais próxima de cada membro."))),h(ClusterMap,{cluster})),
      h("div",{className:"section-grid two-grid cluster-context"},
        h("section",{className:"card"},h("div",{className:"card-head"},h("div",null,h("h3",null,"Lojas do Canal AA no entorno"),h("p",null,"Ordenadas pela menor distância a uma cidade do cluster."))),h("div",{className:"network-list"},...(cluster.nearbyAa||[]).slice(0,8).map(x=>h("div",{key:x.ibge},h("b",null,`${x.cidade} | ${km(x.distancia_cluster_km)}`),h("span",null,`${fmt(x.lojas)} loja(s) | ${x.lojas_detalhes}`))))),
        h("section",{className:"card"},h("div",{className:"card-head"},h("div",null,h("h3",null,"Lojas Vivo no entorno"),h("p",null,"Presença física concorrente próxima ao agrupamento."))),h("div",{className:"network-list"},...(cluster.nearbyVivo||[]).slice(0,8).map(x=>h("div",{key:x.ibge},h("b",null,`${x.cidade} | ${km(x.distancia_cluster_km)}`),h("span",null,`${fmt(x.lojas)} loja(s) | BL ${pct(x.share_vivo_bl)} | Pós ${pct(x.share_vivo_pos)}`)))))
      ),
      h("section",{className:"card table-card"},
        h("div",{className:"table-head"},
          h("div",null,h("h2",null,"Cidades selecionadas no cluster"),h("p",null,"Mercado local e referências de rede para leitura regional.")),
          h("span",{className:"pill"},`${fmt(cluster.members.length)} cidades`)
        ),
        h("div",{className:"table-wrap"},
          h("table",{className:"data-table"},
            h("thead",null,h("tr",null,h("th",null,"Cidade"),h("th",null,"População / Base"),h("th",null,"Share BL"),h("th",null,"Share pós"),h("th",null,"Lojas"),h("th",null,"AA mais próxima"),h("th",null,"Vivo mais próxima"))),
            h("tbody",null,...cluster.members.map(m=>h("tr",{key:m.ibge},
              h("td",null,h("b",null,m.municipio),h("span",{className:"muted"},`${m.faixa_pop} | ${m.area}`)),
              h("td",null,h("b",null,fmt(m.populacao)),h("span",{className:"muted"},`${fmt(m.base_desktop)} base Desktop`)),
              h("td",null,h("b",null,`Claro ${pct(m.share_claro_bl)} | Vivo ${pct(m.share_vivo_bl)}`),h("span",{className:"muted"},`Desktop ${pct(m.share_desktop)}`)),
              h("td",null,h("b",null,`Claro ${pct(m.share_claro_pos)}`),h("span",{className:"muted"},`Vivo ${pct(m.share_vivo_pos)}`)),
              h("td",null,h("b",null,`Desktop ${fmt(m.lojas_desktop)}`),h("span",{className:"muted"},`Vivo ${fmt(m.lojas_vivo)} | AA 0`)),
              h("td",null,h("b",null,m.receptor_cidade),h("span",{className:"muted"},km(m.distancia_receptor_km))),
              h("td",null,h("b",null,m.vivo_referencia_cidade),h("span",{className:"muted"},km(m.distancia_vivo_km)))
            )))
          )
        )
      )
    );
  }
}

function CoverageChip({value}){
  return h("span", {className: chipClass(value)}, value || "sem dado");
}

class CityTable extends React.Component {
  constructor(props){
    super(props);
    this.state = {sortKey:"base_desc"};
  }
  render(){
  const {title, subtitle, rows, mode, onSelect} = this.props;
  const sortKey = this.state.sortKey;
  const sortedRows = rows.slice().sort((a,b)=>{
    if(sortKey === "base_desc") return (Number(b.base_desktop)||0) - (Number(a.base_desktop)||0);
    if(sortKey === "populacao_desc") return (Number(b.populacao)||0) - (Number(a.populacao)||0);
    if(sortKey === "distancia_asc") return (Number(a.distancia_receptor_km)||0) - (Number(b.distancia_receptor_km)||0);
    return String(a.municipio||"").localeCompare(String(b.municipio||""), "pt-BR");
  });
  return h("section", {className:"card table-card"},
    h("div", {className:"table-head"},
      h("div", null, h("h2", null, title), h("p", null, subtitle)),
      h("div", {className:"table-actions"},
        h("label", null, h("span", null, "Ordenar por"), h("select", {value:sortKey, onChange:e=>this.setState({sortKey:e.target.value}), "aria-label":"Ordenar cidades"},
          h("option", {value:"base_desc"}, "Maior Base Desktop"),
          h("option", {value:"populacao_desc"}, "Maior população"),
          h("option", {value:"distancia_asc"}, "Menor distância"),
          h("option", {value:"cidade_asc"}, "Cidade A-Z")
        )),
        h("span", {className:"pill"}, `${fmt(rows.length)} registros`)
      )
    ),
    h("div", {className:"table-wrap"},
      h("table", {className:"data-table"},
        h("thead", null, h("tr", null,
          h("th", null, "Cidade Desktop"),
          h("th", null, "População"),
          h("th", null, "Base / Share"),
          mode === "with" ? h("th", null, "Share Claro + Desktop") : h("th", null, "Distância / Cidade com loja"),
          h("th", null, "Lojas na cidade indicada"),
          h("th", null, "Estrutura das lojas"),
          h("th", null, "Mercado da cidade Desktop"),
          h("th", null, "TIPO")
        )),
        h("tbody", null,
          ...sortedRows.map(row => h("tr", {key:row.ibge},
            h("td", null,
              h("button", {className:"city-button", onClick:()=>onSelect({kind:"city", item:row})}, row.municipio),
              h("span", {className:"muted"}, row.status_cobertura + " | IBGE " + row.ibge)
            ),
            h("td", null, h("b", null, fmt(row.populacao)), h("span", {className:"muted"}, row.faixa_pop)),
            h("td", null, h("b", null, fmt(row.base_desktop)), h("span", {className:"muted"}, `Share Desktop ${pct(row.share_desktop)} (${pp(row.share_desktop)})`)),
            mode === "with"
              ? h("td", null, h("b", null, pct(row.share_combinado_potencial)), h("span", {className:"muted"}, `Claro ${pct(row.share_claro)} + Desktop ${pct(row.share_desktop)}`))
              : h("td", null,
                  h("b", null, km(row.distancia_receptor_km)),
                  h("span", {className:"muted"}, `${row.receptor_cidade} | ${row.receptor_lojas} loja(s) AA`),
                  h("span", {className:"muted"}, `Vivo: ${row.vivo_referencia_cidade} | ${km(row.distancia_vivo_km)}`)
                ),
            h("td", null,
              h("b", null, `${fmt(row.receptor_lojas)} loja(s)`),
              h("span", {className:"muted"}, `${fmt(row.receptor_lojas_rua)} rua | ${fmt(row.receptor_lojas_shopping)} shopping`),
              h("span", {className:"store-identities"}, row.receptor_lojas_resumo || "sem identificação")
            ),
            h("td", null, h("b", null, row.receptor_conceitos), h("span", {className:"muted"}, row.receptor_produtividade_mix), h("span", {className:"muted"}, `Grupos: ${row.receptor_grupos_mix}`)),
            h("td", null,
              h("b", null, `Base Claro ${fmt(row.base_claro)} | Base Desktop ${fmt(row.base_desktop)}`),
              h("span", {className:"muted"}, `BL: Claro ${pct(row.share_claro_bl)} | Vivo ${pct(row.share_vivo_bl)} | Desktop ${pct(row.share_desktop)}`),
              h("span", {className:"muted"}, `Pós: Claro ${pct(row.share_claro_pos)} | Vivo ${pct(row.share_vivo_pos)} | Lojas Vivo ${fmt(row.lojas_vivo)}`),
              null
            ),
            h("td", null, h(CoverageChip, {value:row.area}))
          ))
        )
      )
    )
  );
  }
}

function NoAaPage({cities, clusters, onSelect}){
  const rows = sortDesc(cities.filter(x => !x.tem_loja_aa), "base_desktop");
  return h(CityTable, {
      title:"Cidades Desktop sem Lojas do Canal AA",
      subtitle:"Mercado da própria cidade Desktop, distância e identificação das lojas da cidade AA mais próxima.",
      rows, mode:"without", onSelect
    });
}

function WithAaPage({aaCities, onSelect}){
  const storeCount=aaCities.reduce((sum,city)=>sum+city.lojas,0);
  return h("section", {className:"card table-card"},
    h("div", {className:"table-head"},
      h("div", null,
        h("h2", null, "Cidades com Lojas do Canal AA"),
        h("p", null, "Cada linha consolida somente os PDVs que atendem simultaneamente aos filtros selecionados.")
      ),
      h("span", {className:"pill"}, `${fmt(aaCities.length)} cidades | ${fmt(storeCount)} lojas`)
    ),
    h("div", {className:"table-wrap"},
      h("table", {className:"data-table"},
        h("thead", null, h("tr", null,
          h("th", null, "Cidade AA"),
          h("th", null, "População"),
          h("th", null, "Lojas filtradas"),
          h("th", null, "Layout / produtividade"),
          h("th", null, "Grupos"),
          h("th", null, "Mercado local"),
          h("th", null, "Desktop na cidade")
        )),
        h("tbody", null, ...aaCities.map(city=>h("tr", {key:city.ibge},
          h("td", null,
            h("button", {className:"city-button", onClick:()=>onSelect({kind:"aa-city",item:city})}, city.cidade),
            h("span", {className:"muted"}, `${city.territorio} | IBGE ${city.ibge}`)
          ),
          h("td", null, h("b", null, fmt(city.populacao)), h("span", {className:"muted"}, city.faixa_pop)),
          h("td", null,
            h("b", null, `${fmt(city.lojas)} loja(s) | ${fmt(city.lojas_rua)} rua | ${fmt(city.lojas_shopping)} shopping`),
            h("span", {className:"store-identities"}, city.lojas_resumo)
          ),
          h("td", null, h("b", null, city.conceitos), h("span", {className:"muted"}, city.produtividade_mix), h("span", {className:"muted"}, `Média ${fmt(city.m2_medio,1)} m²`)),
          h("td", null, h("b", null, city.grupos_mix), h("span", {className:"muted"}, `PDVs: ${city.pdvs}`)),
          h("td", null,
            h("b", null, `Base Claro ${fmt(city.base_claro)} | BL Claro ${pct(city.share_claro_bl)}`),
            h("span", {className:"muted"}, `Vivo ${fmt(city.lojas_vivo)} loja(s) | BL ${pct(city.share_vivo_bl)} | Pós ${pct(city.share_vivo_pos)}`)
          ),
          h("td", null,
            h("b", null, city.tem_desktop ? fmt(city.base_desktop) : "Sem atuação Desktop"),
            h("span", {className:"muted"}, city.tem_desktop ? `Share Desktop ${pct(city.share_desktop)}` : "Cidade fora das 173 Desktop")
          )
        )))
      )
    )
  );
}

function ReceptorsPage({receptors, stores, onSelect}){
  const rows = sortDesc(receptors, "base_desktop_sem_aa");
  const groups=groupImpactFromStores(stores);
  return h(Fragment,null,
    h(SectionTitle,{title:"1. Lojas e grupos expostos",text:"Distribuição teórica da base das cidades sem loja, com identificação dos PDVs, grupos e origens.",tag:"PREMISSA DE MENOR DISTÂNCIA"}),
    h("div",{className:"section-grid two-grid"},
      h("section",{className:"card"},h("div",{className:"card-head"},h("div",null,h("h3",null,"Demanda potencial por grupo"),h("p",null,"Abra cada linha para ver todas as cidades de origem."))),h(GroupImpactTable,{groups,limit:20})),
      h("section",{className:"card"},h("div",{className:"card-head"},h("div",null,h("h3",null,"PDVs com maior exposição"),h("p",null,"Cada linha identifica loja, grupo, cidade, estrutura e origens."))),h(StoreDemandList,{stores,limit:20}))
    ),
    h("section",{className:"card table-card"},
      h("div",{className:"table-head"},h("div",null,h("h2",null,"Detalhamento por loja impactada"),h("p",null,"Demanda potencial, origens, estrutura e operação observada de agosto/2026.")),h("span",{className:"pill"},`${fmt(stores.filter(s=>(Number(s.demanda_externa_teorica)||0)>0).length)} lojas`)),
      h(StoreImpactTable,{stores,limit:999})
    ),
    h(SectionTitle,{title:"2. Cidades com Lojas do Canal AA",text:"Capacidade aparente por cidade, sem esconder quando existem múltiplos PDVs ou grupos.",tag:"VISÃO POR CIDADE"}),
    h("section", {className:"card table-card"},
      h("div", {className:"table-head"},
        h("div", null, h("h2", null, "Cidades que podem receber fluxo externo"), h("p", null, "Base potencial, estrutura, operação e todas as lojas existentes na cidade.")),
        h("span", {className:"pill"}, `${fmt(rows.length)} cidades`)
      ),
      h("div", {className:"table-wrap"},
        h("table", {className:"data-table"},
          h("thead", null, h("tr", null,
            h("th", null, "Cidade com loja"), h("th", null, "População"),
            h("th", null, "Fluxo teórico"), h("th", null, "Cidades recebidas"), h("th", null, "Base / loja"),
            h("th", null, "Lojas e grupos"), h("th", null, "Estrutura e operação"), h("th", null, "Mercado / Share")
          )),
          h("tbody", null,...rows.map(r => h("tr", {key:r.receptor_ibge},
            h("td", null, h("button", {className:"city-button", onClick:()=>onSelect({kind:"receptor", item:r})}, r.receptor_cidade), h("span", {className:"muted"}, `${r.territorio} | IBGE ${r.receptor_ibge}`)),
            h("td", null, h("b", null, fmt(r.populacao)), h("span", {className:"muted"}, r.faixa_pop)),
            h("td", null, h("b", null, `${fmt(r.base_desktop_sem_aa)} de base externa`), h("span", {className:"muted"}, `Maior origem ${r.maior_origem} (${fmt(r.maior_origem_base)})`)),
            h("td", null, h("b", null, fmt(r.desktop_cidades_sem_aa)), h("span", {className:"muted"}, `${fmt(r.desktop_cidades_total)} cidades Desktop no total | distância máx. ${km(r.distancia_max_sem_aa_km)}`)),
            h("td", null, h("b", null, fmt(r.base_sem_aa_por_loja,1)), h("span", {className:"muted"}, `${fmt(r.lojas)} loja(s) | ${fmt(r.base_desktop_total)} base total atribuída`)),
            h("td", null, h("b", null, r.lojas_resumo), h("span", {className:"muted"}, `Grupos: ${r.grupos_mix}`)),
            h("td", null, h("b", null, r.conceitos), h("span", {className:"muted"}, r.produtividade_mix),h("span",{className:"muted"},`${fmt(r.senhas_atendidas)} senhas | ${fmt(r.fluxo_atendimentos)} fluxo`)),
            h("td", null, h("b", null, `Base Claro ${fmt(r.base_claro)} | Desktop ${fmt(r.base_desktop_cidade)}`), h("span", {className:"muted"}, `Share Claro ${pct(r.share_claro)}`))
          )))
        )
      )
    )
  );
}

function FlowPage({stores}){
  const actionOrder={"VALIDAR PROCESSO DE SENHAS":0,"MONITORAR ALTO VOLUME":1,"COMPLETAR DADOS":2,"ROTINA":3};
  const rows = stores.slice().sort((a,b)=>(actionOrder[a.acao_operacional]??9)-(actionOrder[b.acao_operacional]??9) || (Number(b.fluxo_atendimentos)||0)-(Number(a.fluxo_atendimentos)||0));
  const atendidas = stores.reduce((s,x)=>s+(Number(x.senhas_atendidas)||0),0);
  const suspeitas = stores.reduce((s,x)=>s+(Number(x.senhas_suspeitas)||0),0);
  const fluxo = stores.reduce((s,x)=>s+(Number(x.fluxo_atendimentos)||0),0);
  const demanda = stores.reduce((s,x)=>s+(Number(x.demanda_externa_teorica)||0),0);
  const lojasComSenha = stores.filter(x=>x.senhas_atendidas!=null).length;
  const lojasComFluxo = stores.filter(x=>x.fluxo_atendimentos!=null).length;
  const validar = stores.filter(x=>x.acao_operacional==="VALIDAR PROCESSO DE SENHAS").sort((a,b)=>(b.taxa_suspeita||0)-(a.taxa_suspeita||0)).slice(0,8);
  const altoVolume = stores.filter(x=>x.acao_operacional==="MONITORAR ALTO VOLUME").sort((a,b)=>(b.fluxo_atendimentos||0)-(a.fluxo_atendimentos||0)).slice(0,8);
  return h(Fragment, null,
    h("div", {className:"flow-kpis"},
      h(Kpi, {label:"Senhas atendidas", value:fmt(atendidas), note:`Não canceladas em ${fmt(lojasComSenha)} lojas`, color:"blue"}),
      h(Kpi, {label:"Sinal abaixo de 1 minuto", value:fmt(suspeitas), note:`${pct(atendidas ? suspeitas/atendidas : null)} das senhas atendidas`, color:"amber"}),
      h(Kpi, {label:"Atendimentos por produto", value:fmt(fluxo), note:`Base Fluxo em ${fmt(lojasComFluxo)} lojas`, color:"green"}),
      h(Kpi, {label:"Demanda externa teórica", value:fmt(demanda,1), note:`Distribuída entre ${fmt(stores.filter(x=>(Number(x.demanda_externa_teorica)||0)>0).length)} lojas`, color:"red"})
    ),
    h("div",{className:"model-callout"},h("b",null,"Interpretação"),h("span",null,"Demanda potencial, volume observado e processo de senhas são medidas diferentes e aparecem lado a lado por PDV.")),
    h("div", {className:"section-grid three-grid"},
      h("section", {className:"card"}, h("div", {className:"card-head"}, h("div", null, h("h3", null, "Maior demanda potencial"), h("p", null, "Lojas que mais absorveriam base pela hipótese de menor distância."))),
        h(StoreDemandList,{stores,limit:8})),
      h("section", {className:"card"}, h("div", {className:"card-head"}, h("div", null, h("h3", null, "Validar processo de senhas"), h("p", null, "100+ atendimentos e taxa abaixo de 1 minuto no quartil superior."))),
        h("div", {className:"mini-action-list single"}, ...validar.map(s=>h("div", {key:s.pdv}, h("b", null, `${s.pdv} | ${s.grupo}`), h("span", null, `${s.cidade} | ${pct(s.taxa_suspeita)} abaixo de 1 min | ${fmt(s.senhas_atendidas)} atendidas`))))),
      h("section", {className:"card"}, h("div", {className:"card-head"}, h("div", null, h("h3", null, "Monitorar alto volume"), h("p", null, "Lojas no quartil superior de atendimentos classificados."))),
        h("div", {className:"mini-action-list single"}, ...altoVolume.map(s=>h("div", {key:s.pdv}, h("b", null, `${s.pdv} | ${s.grupo}`), h("span", null, `${s.cidade} | ${fmt(s.fluxo_atendimentos)} atendimentos | ${s.localidade}`)))))
    ),
    h("section", {className:"card table-card"},
      h("div", {className:"table-head"},
        h("div", null, h("h2", null, "Desempenho e fluxo por loja"), h("p", null, "Senhas, tempos suspeitos e mix de atendimentos de agosto/2026. Ausência de dado não é tratada como zero.")),
        h("span", {className:"pill"}, `${fmt(rows.length)} lojas`)
      ),
      h("div", {className:"table-wrap"}, h("table", {className:"data-table"},
        h("thead", null, h("tr", null,
          h("th", null, "Ação"), h("th", null, "Loja"), h("th", null, "Demanda potencial"), h("th", null, "Cidades de origem"), h("th", null, "Estrutura"), h("th", null, "Senhas"), h("th", null, "Sinais suspeitos"),
          h("th", null, "Tempo atend."), h("th", null, "Fluxo produto"), h("th", null, "Mix de produtos"), h("th", null, "Horários")
        )),
        h("tbody", null, ...rows.map(s=>h("tr", {key:s.pdv},
          h("td", null, h(CoverageChip,{value:s.acao_operacional})),
          h("td", null, h("b", null, s.pdv), h("span", {className:"muted"}, `${s.cidade} | ${s.grupo}`)),
          h("td", null, h("b", null, fmt(s.demanda_externa_teorica,1)), h("span", {className:"muted"}, "Divisão igual entre os PDVs da cidade")),
          h("td", null, h("b", null, fmt(s.cidades_origem_qtd)), h("span", {className:"muted"}, s.cidades_origem || "sem cidade atribuída")),
          h("td", null, h(CoverageChip,{value:s.localidade}), h("span", {className:"muted"}, `${s.conceito} | ${fmt(s.m2,1)} m² | ${s.media_produtividade}`)),
          h("td", null, h("b", null, fmt(s.senhas_atendidas)), h("span", {className:"muted"}, `${fmt(s.senhas_emitidas)} emitidas | ${fmt(s.senhas_canceladas)} canceladas`)),
          h("td", null, h("b", null, fmt(s.senhas_suspeitas)), h("span", {className:"muted"}, `${pct(s.taxa_suspeita)} < 1 min | ${fmt(s.senhas_zero)} zeradas`)),
          h("td", null, h("b", null, duration(s.tempo_atendimento_mediano_seg)), h("span", {className:"muted"}, `mediana | média ${duration(s.tempo_atendimento_medio_seg)}`)),
          h("td", null, h("b", null, fmt(s.fluxo_atendimentos)), h("span", {className:"muted"}, "Atendimentos classificados")),
          h("td", null, h("b", null, `Móvel ${fmt(s.fluxo_movel)} | Resid ${fmt(s.fluxo_residencial)}`), h("span", {className:"muted"}, `Conta ${fmt(s.fluxo_conta)} | Controle ${fmt(s.fluxo_controle)} | BL ${fmt(s.fluxo_bl)} | BL fixo ${fmt(s.fluxo_bl_fixo)}`)),
          h("td", null, h("b", null, s.fim_semana), h("span", {className:"muted"}, `${s.horario_semana} | Sáb ${s.horario_sabado} | Dom ${s.horario_domingo}`))
        )))
      ))
    )
  );
}

function MethodPage({data}){
  const q=data.quality;
  return h(Fragment,null,
    h(SectionTitle,{title:"Regras, cálculos e limites",text:"Definições usadas para integrar mercado municipal, redes físicas, lojas e atendimento.",tag:"AUDITÁVEL"}),
    h("div", {className:"method-grid"},
      h("section", {className:"card method-card"},
        h("div", {className:"card-head"}, h("div", null, h("h2", null, "Regras do projeto"), h("p", null, "Grãos, chaves e tratamento das fontes."))),
        h("ul", {className:"method-list"},
          h("li",null,h("b",null,"Fontes preservadas"),h("span",null,"O processo somente lê as bases originais e grava cópias de trabalho e arquivos derivados.")),
          h("li",null,h("b",null,"Fontes municipais"),h("span",null,"BASE_GERAL fornece população, shares BL/Pós e tecnologias; BASE_DESKTOP fornece atuação, base e lojas Desktop.")),
          h("li",null,h("b",null,"Redes físicas"),h("span",null,"BASE_AA identifica cada PDV do Canal AA; BASE_VIVO informa a quantidade de lojas Vivo por cidade.")),
          h("li",null,h("b",null,"Chave municipal"),h("span",null,"Código IBGE cruza BASE_AA, BASE_DESKTOP, BASE_VIVO, BASE_GERAL e BASE_CIDADES_APOIO.")),
          h("li",null,h("b",null,"Chave de loja"),h("span",null,"PDV da BASE_AA é relacionado a AMDOCS em Senha_Ago e a Código mobile em Fluxo.")),
          h("li",null,h("b",null,"Grãos separados"),h("span",null,"Cidade, presença física, loja/PDV e grupo não são somados como se fossem o mesmo nível.")),
          h("li",null,h("b",null,"Capilaridade"),h("span",null,`${fmt(q.checks.base_aa_rows)} lojas entram na rede, incluindo ${fmt(data.summary.xpto_lojas)} códigos XPTO.`)),
          h("li",null,h("b",null,"Ausência de dado"),h("span",null,"Campos não encontrados em senha ou fluxo permanecem como sem dado; não viram zero."))
        )
      ),
      h("section", {className:"card method-card"},
        h("div", {className:"card-head"}, h("div", null, h("h2", null, "Cálculos utilizados"), h("p", null, "Fórmulas apresentadas no painel."))),
        h("div",{className:"formula-list"},
          h("div",null,h("b",null,"Share combinado potencial"),h("code",null,"SHARE_CLARO + SHARE_DESKTOP"),h("span",null,"Calculado apenas nas cidades onde as duas bases coexistem.")),
          h("div",null,h("b",null,"Base externa por loja"),h("code",null,"BASE_DESKTOP das cidades sem loja ÷ lojas na cidade AA"),h("span",null,"É uma divisão teórica igualitária, não fluxo observado.")),
          h("div",null,h("b",null,"Distância"),h("code",null,"Haversine entre centroides municipais"),h("span",null,"Não representa rota rodoviária ou tempo de viagem.")),
          h("div",null,h("b",null,"Shares agregados"),h("code",null,"Soma(share × população) ÷ soma(população)"),h("span",null,"Aplicado somente aos municípios com share numérico no recorte.")),
          h("div",null,h("b",null,"Clusters exploratórios"),h("code",null,"Cidades sem AA, distantes 25+ km, conectadas em raio de 35 km"),h("span",null,"São agrupamentos geográficos para investigação; não definem abertura de loja.")),
          h("div",null,h("b",null,"Taxa abaixo de 1 minuto"),h("code",null,"senhas atendidas < 00:01:00 ÷ senhas atendidas"),h("span",null,"Senhas canceladas ficam fora do denominador."))
        )
      ),
      h("section", {className:"card method-card"},
        h("div", {className:"card-head"}, h("div", null, h("h2", null, "Separação entre cidade e destino"), h("p", null, "Regra de grão aplicada às cidades Desktop."))),
        h("ul", {className:"method-list"},
          h("li",null,h("b",null,"Mercado da cidade Desktop"),h("span",null,"Base Desktop e Share Desktop pertencem sempre à cidade exibida na linha.")),
          h("li",null,h("b",null,"Share sem presença física"),h("span",null,"Shares Claro e Vivo vêm da BASE_GERAL mesmo quando não existe loja. A ausência de loja é mostrada separadamente.")),
          h("li",null,h("b",null,"Base Claro"),h("span",null,"É exibida quando disponível no grão municipal da BASE_AA; nunca é herdada da cidade receptora.")),
          h("li",null,h("b",null,"Cidade com loja indicada"),h("span",null,"A cidade receptora fornece apenas distância e identificação das lojas, layouts e grupos que podem receber atendimento.")),
          h("li",null,h("b",null,"Processo de senhas"),h("span",null,"Loja com pelo menos 100 senhas atendidas e taxa abaixo de 1 minuto no quartil superior.")),
          h("li",null,h("b",null,"Produtividade"),h("span",null,"PRODUTIVA, ATENCAO, IMPRODUTIVA ou SEM AVALIACAO vêm da BASE_AA; não é uma média recalculada pelo painel."))
        )
      ),
      h("section", {className:"card method-card"},
        h("div", {className:"card-head"}, h("div", null, h("h2", null, "Limites de interpretação"), h("p", null, "O que os resultados não devem afirmar sozinhos."))),
        h("ul", {className:"method-list limits"},
          h("li",null,"Demanda teórica não é previsão de visita, migração ou venda."),
          h("li",null,"Cidade mais próxima por coordenada municipal pode não ser a viagem mais curta por estrada."),
          h("li",null,"Sinal abaixo de um minuto pede auditoria de processo; não comprova irregularidade."),
          h("li",null,"Share combinado é cenário aritmético e não considera sobreposição, churn ou comportamento pós-aquisição.")
        )
      )
    )
  );
}

function DetailDrawer({selected, onClose, data}){
  if(!selected) return null;
  const item = selected.item;
  const isReceptor = selected.kind === "receptor";
  const isAaCity = selected.kind === "aa-city";
  return h("div", {className:"drawer-backdrop", onClick:onClose},
    h("aside", {className:"drawer", onClick:e=>e.stopPropagation()},
      h("button", {className:"drawer-close", onClick:onClose}, "×"),
      h("div", {className:"eyebrow"}, isAaCity ? "Cidade com Lojas do Canal AA" : isReceptor ? "Cidade com loja do Canal AA" : "Cidade Desktop"),
      h("h2", null, isAaCity ? item.cidade : isReceptor ? item.receptor_cidade : item.municipio),
      h("p", null, isAaCity
        ? `${item.territorio}. ${fmt(item.lojas)} loja(s) no recorte atual.`
        : isReceptor
        ? `${item.territorio}. Recebe potencialmente ${fmt(item.desktop_cidades_sem_aa)} cidades Desktop sem loja do Canal AA.`
        : `${item.status_cobertura}. Cidade com loja indicada pela menor distância municipal.`
      ),
      isAaCity ? h(AaCityDetail,{item}) : isReceptor ? h(ReceptorDetail, {item, data}) : h(CityDetail, {item, data})
    )
  );
}

function StoreCards({stores}){
  if(!stores.length) return h("div", {className:"empty-note"}, "Nenhuma loja AA vinculada.");
  return h("div", {className:"store-list"}, ...stores.map(s=>h("div", {className:"store-card", key:s.pdv},
    h("div", {className:"store-card-head"}, h("b", null, s.pdv), h(CoverageChip,{value:s.localidade})),
    h("span", null, `${s.grupo} | ${s.conceito} | ${fmt(s.m2,1)} m² | ${s.media_produtividade}`),
    h("span", null, `Senhas atendidas ${fmt(s.senhas_atendidas)} | < 1 min ${fmt(s.senhas_suspeitas)} (${pct(s.taxa_suspeita)}) | Fluxo ${fmt(s.fluxo_atendimentos)}`),
    h("span", {className:"store-demand"}, `Demanda externa teórica ${fmt(s.demanda_externa_teorica,1)} | ${fmt(s.cidades_origem_qtd)} origem(ns): ${s.cidades_origem || "nenhuma"}`)
  )));
}

function AaCityDetail({item}){
  return h(Fragment,null,
    h("div",{className:"drawer-kpis"},
      h("div",null,h("b",null,fmt(item.populacao)),h("span",null,"População")),
      h("div",null,h("b",null,fmt(item.lojas)),h("span",null,"Lojas filtradas")),
      h("div",null,h("b",null,`${fmt(item.lojas_rua)} / ${fmt(item.lojas_shopping)}`),h("span",null,"Rua / shopping")),
      h("div",null,h("b",null,fmt(item.m2_medio,1)),h("span",null,"m² médios")),
      h("div",null,h("b",null,item.tem_desktop ? fmt(item.base_desktop) : "-"),h("span",null,"Base Desktop"))
    ),
    h("div",{className:"detail-grid"},
      h("div",{className:"detail-box"},
        h("h3",null,"Estrutura filtrada"),
        h("div",null,h("span",null,"Faixa POP"),h("b",null,item.faixa_pop)),
        h("div",null,h("span",null,"Layouts"),h("b",null,item.conceitos)),
        h("div",null,h("span",null,"Produtividade"),h("b",null,item.produtividade_mix)),
        h("div",null,h("span",null,"Grupos"),h("b",null,item.grupos_mix)),
        h("div",null,h("span",null,"PDVs"),h("b",null,item.pdvs))
      ),
      h("div",{className:"detail-box"},
        h("h3",null,"Mercado local"),
        h("div",null,h("span",null,"Base Claro"),h("b",null,fmt(item.base_claro))),
        h("div",null,h("span",null,"Share Claro"),h("b",null,pct(item.share_claro))),
        h("div",null,h("span",null,"Base Desktop"),h("b",null,item.tem_desktop ? fmt(item.base_desktop) : "Sem atuação Desktop")),
        h("div",null,h("span",null,"Share Desktop"),h("b",null,item.tem_desktop ? pct(item.share_desktop) : "sem dado"))
      )
    ),
    h("h3",{className:"drawer-section-title"},`Lojas filtradas em ${item.cidade}`),
    h(StoreCards,{stores:item.stores})
  );
}

function NearbyAaCities({cities}){
  const rows = (cities || []).slice(0, 5);
  if(!rows.length) return null;
  return h(Fragment, null,
    h("h3", {className:"drawer-section-title"}, "Cidades com lojas mais próximas"),
    h("div", {className:"nearby-list"}, ...rows.map(city=>h("div", {className:"nearby-row", key:city.ibge},
      h("div", {className:"nearby-rank"}, city.ordem),
      h("div", null,
        h("b", null, city.cidade),
        h("span", null, `${km(city.distancia_km)} | ${fmt(city.lojas)} loja(s) | ${fmt(city.lojas_rua)} rua | ${fmt(city.lojas_shopping)} shopping`),
        h("small", null, city.lojas_detalhes || `${city.conceitos} | Grupos: ${city.grupos}`)
      )
    )))
  );
}

function CityDetail({item, data}){
  const stores = data.aaStores.filter(s=>Number(s.ibge)===Number(item.receptor_ibge));
  return h(Fragment, null,
    h("div", {className:"drawer-kpis"},
      h("div", null, h("b", null, fmt(item.populacao)), h("span", null, "População")),
      h("div", null, h("b", null, fmt(item.base_desktop)), h("span", null, "Base Desktop")),
      h("div", null, h("b", null, pct(item.share_desktop)), h("span", null, "Share Desktop")),
      h("div", null, h("b", null, `${fmt(item.lojas_aa)} / ${fmt(item.lojas_vivo)}`), h("span", null, "Lojas AA / Vivo")),
      h("div", null, h("b", null, fmt(item.lojas_desktop)), h("span", null, "Lojas Desktop"))
    ),
    h("div", {className:"detail-grid"},
      h("div", {className:"detail-box"},
        h("h3", null, "Cobertura e mercado"),
        h("div", null, h("span", null, "Status"), h("b", null, item.status_cobertura)),
        h("div", null, h("span", null, "Faixa populacional"), h("b", null, item.faixa_pop)),
        h("div", null, h("span", null, "TIPO"), h("b", null, item.area)),
        h("div", null, h("span", null, "Share BL Claro"), h("b", null, pct(item.share_claro_bl))),
        h("div", null, h("span", null, "Share BL Vivo"), h("b", null, pct(item.share_vivo_bl))),
        h("div", null, h("span", null, "Share BL Desktop"), h("b", null, pct(item.share_desktop))),
        h("div", null, h("span", null, "Share pós Claro"), h("b", null, pct(item.share_claro_pos))),
        h("div", null, h("span", null, "Share pós Vivo"), h("b", null, pct(item.share_vivo_pos))),
        h("div", null, h("span", null, "Tecnologia"), h("b", null, `Claro ${item.tecnologia_claro||"sem dado"} | Vivo ${item.tecnologia_vivo||"sem dado"}`)),
        h("div", null, h("span", null, "Base Claro"), h("b", null, fmt(item.base_claro))),
        h("div", null, h("span", null, "Base Desktop"), h("b", null, fmt(item.base_desktop))),
      ),
      h("div", {className:"detail-box"},
        h("h3", null, item.tem_loja_aa ? "Lojas na própria cidade" : "Loja AA de referência"),
        h("div", null, h("span", null, "PDV / grupo"), h("b", null, `${item.loja_referencia_pdv} | ${item.loja_referencia_grupo}`)),
        h("div", null, h("span", null, "Conceito"), h("b", null, item.loja_referencia_conceito)),
        h("div", null, h("span", null, "Tipo / tamanho"), h("b", null, `${item.loja_referencia_localidade} | ${fmt(item.loja_referencia_m2,1)} m²`)),
        h("div", null, h("span", null, "Produtividade"), h("b", null, item.loja_referencia_produtividade)),
        h("div", null, h("span", null, "Distância AA"), h("b", null, km(item.distancia_receptor_km))),
        h("div", null, h("span", null, "Vivo mais próxima"), h("b", null, `${item.vivo_referencia_cidade} | ${km(item.distancia_vivo_km)}`))
      )
    ),
    h(NearbyAaCities, {cities:item.cidades_aa_proximas}),
    h("h3", {className:"drawer-section-title"}, `Lojas AA em ${item.receptor_cidade}`),
    h(StoreCards, {stores})
  );
}

function ReceptorDetail({item, data}){
  const stores = data.aaStores.filter(s=>Number(s.ibge)===Number(item.receptor_ibge));
  return h(Fragment, null,
    h("div", {className:"drawer-kpis"},
      h("div", null, h("b", null, fmt(item.populacao)), h("span", null, "População")),
      h("div", null, h("b", null, fmt(item.lojas)), h("span", null, "Lojas")),
      h("div", null, h("b", null, fmt(item.base_desktop_sem_aa)), h("span", null, "Base sem AA")),
      h("div", null, h("b", null, fmt(item.base_sem_aa_por_loja,1)), h("span", null, "Base/loja")),
      h("div", null, h("b", null, fmt(item.desktop_cidades_sem_aa)), h("span", null, "Cidades sem loja do Canal AA"))
    ),
    h("div", {className:"detail-grid"},
      h("div", {className:"detail-box"},
        h("h3", null, "Estrutura"),
        h("div", null, h("span", null, "Lojas"), h("b", null, fmt(item.lojas))),
        h("div", null, h("span", null, "PDVs / grupos"), h("b", null, item.lojas_resumo)),
        h("div", null, h("span", null, "Grupos"), h("b", null, item.grupos_mix)),
        h("div", null, h("span", null, "Rua / shopping"), h("b", null, `${fmt(item.lojas_rua)} / ${fmt(item.lojas_shopping)}`)),
        h("div", null, h("span", null, "Conceitos"), h("b", null, item.conceitos)),
        h("div", null, h("span", null, "Produtividade"), h("b", null, item.produtividade_mix))
      ),
      h("div", {className:"detail-box"},
        h("h3", null, "Mercado e referência"),
        h("div", null, h("span", null, "Base Claro"), h("b", null, fmt(item.base_claro))),
        h("div", null, h("span", null, "Base Desktop"), h("b", null, fmt(item.base_desktop_cidade))),
        h("div", null, h("span", null, "Share Claro"), h("b", null, pct(item.share_claro))),
        h("div", null, h("span", null, "Maior origem"), h("b", null, `${item.maior_origem} (${fmt(item.maior_origem_base)})`)),
        h("div", null, h("span", null, "Loja ref."), h("b", null, `${item.anchor_pdv} | ${item.anchor_grupo}`)),
        h("div", null, h("span", null, "Loja ref. perfil"), h("b", null, `${item.anchor_conceito} | ${fmt(item.anchor_m2,1)} m² | ${item.anchor_produtividade}`))
      )
    ),
    h("h3", {className:"drawer-section-title"}, `Todas as lojas em ${item.receptor_cidade}`),
    h(StoreCards, {stores})
  );
}

class App extends React.Component {
  constructor(props){
    super(props);
    let authenticated = false;
    try { authenticated = sessionStorage.getItem(AUTH_SESSION_KEY) === "1"; } catch(_err){}
    this.state = {data:null, error:null, active:"exec", filters:defaultFilters(), selected:null, authenticated};
    this.setActive = this.setActive.bind(this);
    this.setFilters = this.setFilters.bind(this);
    this.setSelected = this.setSelected.bind(this);
    this.closeDrawer = this.closeDrawer.bind(this);
    this.handleLogin = this.handleLogin.bind(this);
    this.handleLogout = this.handleLogout.bind(this);
    this.loadData = this.loadData.bind(this);
  }
  componentDidMount(){
    if(this.state.authenticated) this.loadData();
  }
  loadData(){
    this.setState({error:null});
    fetch("data/desktop-impact-data.json?ts=" + Date.now(), {cache:"no-store"})
      .then(r => {
        if(!r.ok) throw new Error("Falha ao carregar dados derivados");
        return r.json();
      })
      .then(data => this.setState({data}))
      .catch(err => this.setState({error:err.message}));
  }
  handleLogin(){
    this.setState({authenticated:true}, () => {
      if(!this.state.data) this.loadData();
    });
  }
  handleLogout(){
    try { sessionStorage.removeItem(AUTH_SESSION_KEY); } catch(_err){}
    this.setState({authenticated:false, data:null, error:null, selected:null, active:"exec", filters:defaultFilters()});
  }
  setActive(active){
    this.setState({active, selected:null}, () => window.scrollTo({top:0, left:0, behavior:"auto"}));
  }
  setFilters(filters){ this.setState({filters}); }
  setSelected(selected){ this.setState({selected}); }
  closeDrawer(){ this.setState({selected:null}); }
  render(){
    const {data, error, active, filters, selected, authenticated} = this.state;
    if(!authenticated) return h(LoginScreen, {onLogin:this.handleLogin});
    if(error) return h("div", {className:"loading"}, error);
    if(!data) return h("div", {className:"loading"}, "Carregando dados...");

    const cities = applyCityFilters(data, filters);
    const receptors = applyReceptorFilters(data, filters);
    const stores = applyStoreFilters(data, filters);
    const aaCities = buildAaCities(stores, data);
    let page;
    if(active === "exec") page = h(ExecutivePage, {
      data, cities, receptors, aaCities, stores, filters,
      onFaixaSelect:faixa=>this.setFilters({...filters, faixaPop:filters.faixaPop===faixa ? "Todos" : faixa}),
      onSelect:this.setSelected
    });
    if(active === "mapa") page = h(MapPage, {cities, receptors, aaCities, vivoCities:data.vivoCities, onSelect:this.setSelected});
    if(active === "competicao") page = h(CompetitionPage, {cities, onSelect:this.setSelected});
    if(active === "clusters") page = h(ClustersPage, {clusters:data.clusterCandidates});
    if(active === "sem-aa") page = h(NoAaPage, {cities, onSelect:this.setSelected});
    if(active === "com-aa") page = h(WithAaPage, {aaCities, onSelect:this.setSelected});
    if(active === "receptores") page = h(ReceptorsPage, {receptors, stores, onSelect:this.setSelected});

    return h("div", {className:"app"},
      h(Sidebar, {active, setActive:this.setActive, onLogout:this.handleLogout}),
      h("main", {className:"main"},
        h("div", {className:"content"},
          h(PageHead, {active}),
          active !== "clusters" ? h(FilterStrip, {data, filters, setFilters:this.setFilters, active}) : null,
          page
        )
      ),
      h(DetailDrawer, {selected, onClose:this.closeDrawer, data})
    );
  }
}

const rootEl = document.getElementById("root");
if(ReactDOM.createRoot){
  ReactDOM.createRoot(rootEl).render(h(App));
} else {
  ReactDOM.render(h(App), rootEl);
}
})();
