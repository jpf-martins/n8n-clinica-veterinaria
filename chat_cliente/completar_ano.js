const { normalizarDataHora } = require('./data_hora');

function completarAnoDaMensagem(mensagem, agora = new Date()) {
  return mensagem.replace(/\b(\d{1,2})\/(\d{1,2})(?!\/\d{4})\s*(?:às?|as)?\s*(\d{1,2}):(\d{2})\b/gi,
    (trecho, dia, mes, hora, minuto) => {
      const normalizada = normalizarDataHora(`${dia}/${mes} às ${hora}:${minuto}`, agora);
      if (!normalizada) return trecho;
      const [data, horario] = normalizada.split(' ');
      const [ano, mesCompleto, diaCompleto] = data.split('-');
      return `${diaCompleto}/${mesCompleto}/${ano} às ${horario}`;
    });
}

module.exports = { completarAnoDaMensagem };
