# Memo

Nuvem de memórias para tela touch: lê uma pasta de fotos e vídeos e mostra tudo como uma nuvem navegável, com busca, filtros por pasta e visualização em tela cheia.

## Como rodar

Requer [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm install
npm start          # abre o app
npm run kiosk      # já abre em tela cheia, sem bordas
```

Na primeira vez o app pede a pasta com suas fotos e vídeos (subpastas são lidas junto). A escolha fica salva. Para trocar: botão `⋯` → *Trocar pasta*.

Para gerar um instalador (Windows/Mac/Linux): `npm run dist`.

## Uso

| Ação | Toque | Mouse / teclado |
| --- | --- | --- |
| Navegar pela nuvem | arrastar, pinça para zoom | arrastar, roda para zoom |
| Abrir foto/vídeo | tocar | clicar |
| Próxima / anterior | deslizar para os lados | ← → |
| Fechar | deslizar para baixo | Esc |
| Zoom na foto | pinça ou toque duplo | roda ou clique duplo |
| Apresentação automática | botão ▶ | espaço |
| Tela cheia | botão | F ou F11 |
| Buscar | campo de busca | `/` ou Ctrl+K |

A busca ignora acentos e procura no nome do arquivo e no caminho das pastas. Os chips no topo filtram por pasta (subpastas aparecem numa segunda linha). No layout *Pastas*, tocar no nome de uma pasta filtra por ela.

Formatos: fotos `jpg jpeg png gif webp avif bmp`; vídeos `mp4 webm mov m4v ogv` (o que o Chromium reproduz; vídeos HEVC/H.265 podem não tocar).

## Layouts

Há três: **Nuvem**, **Pastas** (uma ilha por pasta) e **Mosaico**. Para criar outro, adicione um arquivo em `src/renderer/layouts/` e registre em `layouts/index.js`:

```js
export default {
  id: 'meu-layout',
  name: 'Meu layout',
  icon: '<circle cx="12" cy="12" r="6"/>',   // SVG 24x24
  compute(items, { width, height, seed }) {
    const pos = new Map();                    // id -> { x, y, w, h, radius }
    // ... posicione cada item (x, y é o centro) ...
    return { pos, labels: [], bounds: { minX, minY, maxX, maxY } };
  },
};
```

## Estrutura

- `src/main.js`: janela, leitura da pasta, miniaturas em cache e protocolo `memo://` para servir os arquivos.
- `src/preload.js`: ponte segura entre o app e a interface.
- `src/renderer/`: interface (`app.js` nuvem e filtros, `viewer.js` tela cheia, `layouts/`).

Miniaturas ficam em cache na pasta de dados do app; os arquivos originais nunca são alterados.
