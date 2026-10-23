// Roda antes da primeira pintura: aplica as preferências que mudam o visual (modo exposição, efeitos reduzidos),
// para a tela não piscar com a barra e os efeitos completos antes de esconder/reduzir.
try {
  const cls = document.documentElement.classList;
  if (localStorage.getItem('expo') === '1') cls.add('expo');
  if (localStorage.getItem('fx') === 'lite') cls.add('lite');
} catch { /* sem localStorage: segue com o padrão */ }
