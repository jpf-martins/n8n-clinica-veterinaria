// Usa o horário de São Paulo para inferir o ano quando o cliente informa DD/MM.
function normalizarDataHora(valor, agora = new Date()) {
  if (valor == null || String(valor).trim() === '') return null;
  const texto = String(valor).trim();
  let partes = texto.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/);
  let ano, mes, dia, hora, minuto;
  if (partes) {
    [, ano, mes, dia, hora, minuto] = partes.map(Number);
  } else {
    partes = texto.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*(?:às?|as)?\s*(\d{1,2}):(\d{2})(?::\d{2})?$/i);
    if (!partes) return null;
    dia = Number(partes[1]);
    mes = Number(partes[2]);
    ano = partes[3] ? Number(partes[3]) : null;
    hora = Number(partes[4]);
    minuto = Number(partes[5]);
    if (ano === null) {
      const locais = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Sao_Paulo',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(agora).filter(parte => parte.type !== 'literal')
          .map(parte => [parte.type, Number(parte.value)]),
      );
      const presente = Date.UTC(locais.year, locais.month - 1, locais.day,
        locais.hour, locais.minute);
      // A próxima ocorrência futura também cobre 29/02 em ano bissexto.
      for (let candidato = locais.year; candidato <= locais.year + 4; candidato++) {
        const pedido = new Date(Date.UTC(candidato, mes - 1, dia, hora, minuto));
        if (pedido.getUTCFullYear() === candidato &&
            pedido.getUTCMonth() === mes - 1 && pedido.getUTCDate() === dia &&
            pedido.getUTCHours() === hora && pedido.getUTCMinutes() === minuto &&
            pedido.getTime() >= presente) {
          ano = candidato;
          break;
        }
      }
      if (ano === null) return null;
    }
  }
  const data = new Date(Date.UTC(ano, mes - 1, dia, hora, minuto));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 ||
      data.getUTCDate() !== dia || data.getUTCHours() !== hora ||
      data.getUTCMinutes() !== minuto) return null;
  const dois = numero => String(numero).padStart(2, '0');
  return ano + '-' + dois(mes) + '-' + dois(dia) + ' ' + dois(hora) + ':' + dois(minuto);
}

module.exports = { normalizarDataHora };
