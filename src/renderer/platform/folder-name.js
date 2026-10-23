// Nome de pasta digitado pelo usuário -> caminho seguro "A/B": sem "." / "..", partes vazias,
// caracteres de controle ou que o sistema de arquivos não aceita. Vazio significa "Soltas".
export function cleanFolder(input) {
  return String(input ?? '')
    .split('/')
    .map((part) => part.replace(/[\u0000-\u001f\u007f\\:*?"<>|]/g, '').trim().slice(0, 60))
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}
