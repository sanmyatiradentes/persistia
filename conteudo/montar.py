"""Junta os arquivos de conteudo/fonte/*.json em conteudo/diario.js (lido pelo site).

Para editar o conteúdo: altere os .json em conteudo/fonte/ e rode
    python3 conteudo/montar.py
"""
import json
from pathlib import Path

PASTA = Path(__file__).parent
FONTE = PASTA / "fonte"

# ordem dos eixos na alternância: um eixo por dia, sem repetir tema em dias seguidos
EIXOS = ["leituras_cerebro.json", "leituras_metodo.json", "leituras_constancia.json",
         "leituras_mente.json", "leituras_corpo.json", "leituras_prova.json"]


def carregar(nome):
    return json.loads((FONTE / nome).read_text(encoding="utf-8"))


def juntar_leituras():
    grupos = [carregar(n) for n in EIXOS if (FONTE / n).exists()]
    lista = []
    while any(grupos):
        for g in grupos:
            if g:
                lista.append(g.pop(0))
    return lista


dados = {
    "leituras": juntar_leituras(),
    "tecnicas": carregar("tecnicas.json"),
    "constituicao": carregar("constituicao.json"),
    "trilhas": carregar("trilhas.json"),
}

# Conferências mínimas para não publicar conteúdo quebrado.
CAMPOS = {
    "leituras": ["tema", "eixo", "fonte", "ideia", "pratica", "pergunta", "frase"],
    "tecnicas": ["nome", "origem", "em_uma_frase", "como_usar", "exemplo", "armadilha"],
    "constituicao": ["tema", "dispositivo", "o_que_diz", "como_cai", "pegadinha", "link"],
}
for chave, campos in CAMPOS.items():
    for i, it in enumerate(dados[chave]):
        faltam = [c for c in campos if not it.get(c)]
        if faltam:
            raise SystemExit(f"{chave}[{i}] sem {faltam}")
for t in dados["trilhas"]:
    if len(t["dias"]) != 21:
        raise SystemExit(f"trilha {t['id']} tem {len(t['dias'])} dias")

saida = PASTA / "diario.js"
saida.write_text(
    "// Gerado por conteudo/montar.py — edite os .json em conteudo/fonte/\n"
    "window.PERSIS_DIARIO = " + json.dumps(dados, ensure_ascii=False, separators=(",", ":")) + ";\n",
    encoding="utf-8",
)
print({k: len(v) for k, v in dados.items()}, "→", saida)
