# english-coach

Mod para o Claude Code que ajuda a treinar inglês enquanto você trabalha. Cada mensagem que você escreve em inglês é revisada pelo Claude Haiku, e as correções aparecem num painel ao lado do chat, com uma explicação curta em português de cada erro.

A mensagem é enviada **exatamente como você escreveu**: o mod não altera nada e não atrasa o envio. A correção roda em paralelo e aparece no painel 1–2 segundos depois.

![O painel English ao lado do chat, corrigindo "hey, i'm just test my english"](assets/coach.png)

```
42 checked · 31 perfect  [Clear]

✗ I have did the tests yesterday
✓ I did the tests yesterday
  • "I have did" → "I did": com "yesterday" usa-se o passado simples
```

## Instalação

No prompt do Claude Code (terminal):

```
/plugin install english-coach --marketplace newonne/english-coach
```

Responda `y` para adicionar o marketplace e escolha o escopo **user** (Enter). O mod já fica ativo na sessão atual e em todas as próximas.

Pelo shell:

```
claude plugin install english-coach --marketplace newonne/english-coach
```

No app desktop (onde `/plugin` não roda): clique no **+** ao lado da caixa de prompt → **Plugins** → **Add marketplace** com `newonne/english-coach` → **Add plugin**.

## Como usar

- O painel **English** abre sozinho quando o terminal tem largura suficiente (~144 colunas). Em janelas menores, digite `/english` para abrir.
- Escreva seus pedidos em inglês normalmente. Se houver erro, ele aparece no painel: em vermelho o que você escreveu, em verde a versão corrigida, e embaixo o motivo.
- O topo do painel mostra quantas mensagens foram revisadas e quantas estavam perfeitas. **Clear** apaga o histórico.
- O histórico é mantido entre sessões.

## O que não é revisado

- Mensagens em português (ou qualquer idioma que não seja inglês)
- Comandos com `/`
- Mensagens com menos de 3 palavras
- Textos acima de 1500 caracteres (logs e código colados)

Detalhes de chat casual, como começar com letra minúscula ou não colocar ponto final, são ignorados de propósito.

## Custo

Cada mensagem em inglês faz uma chamada curta ao Claude Haiku, cobrada na mesma conta/credenciais da sua sessão do Claude Code. É um custo bem baixo, mas existe.

## Licença

[MIT](LICENSE)
