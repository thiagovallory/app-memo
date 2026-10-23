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

## iPad (Capacitor)

O mesmo app roda no iPad, empacotado com [Capacitor](https://capacitorjs.com). Precisa de um Mac com Xcode e CocoaPods.

```bash
npm install
npm run ios:setup    # cria o projeto em ios/ e liga o app Arquivos, tela sem barra e sem multitarefa
npm run ios:open     # abre no Xcode: escolha o iPad e rode (▶)
npm run ios:sync     # depois de mudar algo em src/renderer
```

No iPad não há seletor de pasta: as fotos ficam na pasta do app, que aparece em **Arquivos › No iPad › Memo**. Copie fotos e vídeos para lá (subpastas viram categorias); ao voltar para o app, ele relê a pasta. A tela fica sempre ligada e sem a barra de status. Para travar o iPad no app, use o **Acesso Guiado** (Ajustes › Acessibilidade) e deixe o Bloqueio Automático em "Nunca". Aceita também HEIC. Com conta Apple gratuita o app instalado expira em 7 dias; com a conta paga não.

O código do iPad fica em `src/renderer/platform/capacitor.js` (mesma API do `preload.js`).

## iPad / navegador (PWA)

O mesmo app roda como site instalável (PWA), sem Xcode: serve para iPads antigos que o Xcode atual não suporta, e para qualquer navegador moderno. Sem internet ele continua funcionando.

**Publicar** (uma vez): em *Settings › Pages › Source*, escolha **GitHub Actions**. A cada merge no `main` o workflow `.github/workflows/pages.yml` publica `src/renderer` em `https://<usuário>.github.io/app-memo/`. Também dá para servir `src/renderer` em qualquer hospedagem estática com HTTPS (o service worker exige HTTPS, ou `localhost`).

**Instalar no iPad**: abra o endereço no Safari › Compartilhar › *Adicionar à Tela de Início*. Abra pelo ícone da tela inicial (tela cheia, sem barra do Safari). Na primeira abertura a página recarrega sozinha uma vez, para o service worker assumir.

**Colocar as fotos**: menu `⋯` › *Importar fotos e vídeos…* (escolha no app Fotos ou Arquivos; dá para marcar várias de uma vez). O seletor do iPad não deixa escolher uma pasta inteira: abra a pasta no seletor, toque em *Selecionar* e marque as fotos. Depois de escolher, o app pergunta **em qual pasta (categoria)** colocá-las (vazio = "Soltas"; `Família/Natal` cria uma subpasta; as pastas que já existem aparecem como atalhos). No computador também dá para **arrastar fotos e pastas inteiras para a janela**, ou usar *Importar uma pasta…*.

Nada é sobrescrito sem aviso: um arquivo com o mesmo nome e tamanho que já está na pasta é ignorado ("já estavam no app"); com o mesmo nome e conteúdo diferente, entra como `nome (2)`. Os arquivos são copiados para o armazenamento do navegador e as miniaturas são geradas na hora. Os originais continuam onde estavam, intactos. No iPad, **importe pelo ícone da tela inicial**, não pelo Safari: os dois têm armazenamentos separados.

**Fotos grandes e espaço:** ao importar, cada foto é decodificada uma vez, **reduzida para no máximo 2560 px no maior lado** (JPEG; GIF e WebP ficam como estão) e já ganha a miniatura. Fotos de câmera têm vários MB e deixam um iPad antigo lento e o armazenamento do navegador cheio (o Safari limita o espaço de cada site); para uma tela de parede, 2560 px continuam nítidos. Se o espaço acabar no meio da importação, o app avisa com um diálogo e para: o que já entrou fica, e importar de novo reconhece o que já está lá. Os originais continuam intactos no aparelho.

**Organizar** (menu `⋯` › *Organizar fotos e pastas…*): no topo da aba *Pastas* aparece o espaço usado e o botão **Otimizar** (reduz as fotos importadas antes desta versão e cria as miniaturas que faltam). A aba *Pastas* lista cada pasta com a contagem e deixa renomear (inclusive juntar duas pastas ou criar subpastas) e excluir; a aba *Fotos* mostra as miniaturas, deixa tocar para selecionar várias e então *Mover…* para outra pasta ou *Excluir*. Isso só apaga as cópias guardadas no app; *Apagar tudo do app* limpa tudo.

**Efeitos** (menu `⋯`): *reduzidos* tira o desfoque animado, as sombras grandes e a mistura de cores e usa menos bolhas. Na primeira abertura o app mede a fluidez e liga sozinho se ficar abaixo de 30 quadros por segundo; dá para mudar à mão.

**Modo exposição** (para o iPad fixo na parede): menu `⋯` › *Modo exposição* esconde o menu `⋯` (sem importar, apagar, trocar pasta ou sair). Para voltar, **segure o logo "memo" por 2 segundos**. Vale também no desktop e no iPad nativo.

**Limites**
- O iOS pode apagar o armazenamento do site se faltar espaço; o app pede armazenamento persistente, mas não há garantia. Se isso acontecer, é só importar de novo.
- A tela fica ligada com a Wake Lock API (iOS 16.4 ou mais novo); deixe também o Bloqueio Automático em "Nunca" e use o Acesso Guiado para travar no app.
- No modo "Adicionar à Tela de Início" o iOS sempre mostra a barra de status (hora e bateria).
- Vídeos: o Safari toca MP4 e MOV (H.264/HEVC), mas não WebM nem OGV.
- Nos iPads mais antigos as bolhas, com desfoque e brilho, podem ficar pesadas.

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
- `src/renderer/platform/`: pontes por plataforma (`capacitor.js` no iPad nativo; `web.js` + `web-db.js` no PWA).
- `src/renderer/sw.js`, `manifest.webmanifest`, `icons/`: service worker e manifesto do PWA.
- `src/renderer/dialog.js`, `manage.js`: diálogos próprios (no lugar de `prompt`/`confirm`, que o iOS pode suprimir) e a tela Organizar.
- `src/preload.js`: ponte segura entre o app e a interface.
- `src/renderer/`: interface (`app.js` nuvem e filtros, `viewer.js` tela cheia, `layouts/`).

Miniaturas ficam em cache na pasta de dados do app (PNG e JPEG são reduzidos pelo processo principal; WebP, AVIF, GIF e JPEG com rotação EXIF são reduzidos pela interface e enviados para o cache). Ao carregar a pasta, o cache de arquivos que não existem mais é limpo. Os arquivos originais nunca são alterados.

## Testes

`npm test` roda os testes dos layouts, da leitura de EXIF e da ponte do iPad (esta com um sistema de arquivos simulado; o app no iPad em si não é testado aqui). `npm run test:web` roda o teste de ponta a ponta do PWA num Chromium real (importação, service worker, Range de vídeo, offline); use `CHROME_PATH=/caminho/do/chrome` se o Playwright não achar o navegador.
