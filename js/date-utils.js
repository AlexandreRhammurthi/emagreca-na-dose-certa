(function initializeDateUtils(global) {
  'use strict';

  function toCivilDate(date) {
    if (!date || typeof date.getFullYear !== 'function' || typeof date.getMonth !== 'function' || typeof date.getDate !== 'function') {
      throw new TypeError('Informe uma data válida para gerar a data civil.');
    }
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    if (![year, month, day].every(Number.isFinite)) {
      throw new RangeError('Não foi possível gerar a data civil.');
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function todayCivil() {
    return toCivilDate(new Date());
  }

  global.DoseDate = Object.freeze({ toCivilDate, todayCivil });
}(typeof window === 'undefined' ? globalThis : window));
