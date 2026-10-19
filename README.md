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
| Buscar | tocar no campo (abre o teclado na tela) | `/` ou Ctrl+K |

A busca ignora acentos e procura no nome do arquivo e no caminho das pastas. Os chips no topo filtram por pasta (subpastas aparecem numa segunda linha). No layout *Pastas*, tocar no nome de uma pasta filtra por ela.

Formatos: fotos `jpg jpeg png gif webp avif bmp`; vídeos `mp4 webm mov m4v ogv` (o que o Chromium reproduz; vídeos HEVC/H.265 podem não tocar).

## Muitas fotos

- **Nuvem** se adapta ao tamanho do acervo: com poucas fotos as bolhas crescem, com muitas encolhem até preencher a tela. Quando passam do que cabe (cerca de 70 a 160, conforme o monitor), mostra um sorteio e troca as fotos sozinha a cada 30 s se ninguém estiver mexendo. O botão embaralhar sorteia outras na hora.
- **Bolhas** (o app sempre abre nele): bolhas de sabão sobem pela tela e, ao sair por qualquer lado, entram outras por baixo ou pelas laterais, então o acervo todo vai passando. Dá para empurrá-las com o dedo ou mouse, e tocar abre a foto.

## Teclado na tela

Tocar no campo de busca abre um teclado próprio (também pelo ícone de teclado no campo). O teclado do sistema não aparece; o teclado físico continua funcionando normalmente.

## Layouts

Há quatro: **Nuvem**, **Bolhas**, **Pastas** (uma ilha por pasta; com acervos grandes mostra uma amostra de cada pasta) e **Mosaico**. Para criar outro, adicione um arquivo em `src/renderer/layouts/` e registre em `layouts/index.js`:

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
- `src/exif.js`: leitura da orientação EXIF de JPEGs.
- `src/preload.js`: ponte segura entre o app e a interface.
- `src/renderer/`: interface (`app.js` nuvem e filtros, `viewer.js` tela cheia, `layouts/`).

Miniaturas ficam em cache na pasta de dados do app (PNG e JPEG são reduzidos pelo processo principal; WebP, AVIF, GIF e JPEG com rotação EXIF são reduzidos pela interface e enviados para o cache). Ao carregar a pasta, o cache de arquivos que não existem mais é limpo. Os arquivos originais nunca são alterados.

## Testes

`npm test` roda os testes dos layouts e da leitura de EXIF (`test/`).
