const $ = (id) => document.getElementById(id);
const inputs = ['vial-mg', 'vial-ml', 'dose-mg'];
const syringeStart = 184;
const syringeEnd = 574;
let currentSimulation = null;
const medicines = Object.freeze([
  Object.freeze({ value: 'tirzepatida', label: 'Tirzepatida' }),
  Object.freeze({ value: 'semaglutida', label: 'Semaglutida' }),
  Object.freeze({ value: 'dulaglutida', label: 'Dulaglutida' }),
  Object.freeze({ value: 'exenatida', label: 'Exenatida' }),
  Object.freeze({ value: 'liraglutida', label: 'Liraglutida' }),
  Object.freeze({ value: 'lixisenatida', label: 'Lixisenatida' }),
  Object.freeze({ value: 'outro', label: 'Outro medicamento' })
]);

window.DoseMedicines = medicines;

function populateMedicineSelect(select) {
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Selecione sua prescrição';
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);
  medicines.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
}

populateMedicineSelect($('medicine'));

const initialSimulation = Object.freeze({
  vialMg: $('vial-mg').value,
  vialMl: $('vial-ml').value,
  doseMg: $('dose-mg').value,
  medicine: $('medicine').value,
  syringeCapacity: document.querySelector('[name="capacity"]:checked').value
});

function calculateDose({ vialMg, vialMl, doseMg, syringeCapacity }) {
  const values = [vialMg, vialMl, doseMg, syringeCapacity].map(Number);
  if (!values.every((value) => Number.isFinite(value) && value > 0)) return null;
  const [normalizedVialMg, normalizedVialMl, normalizedDoseMg, normalizedCapacity] = values;
  const concentration = normalizedVialMg / normalizedVialMl;
  const volumeMl = normalizedDoseMg / concentration;
  const units = volumeMl * 100;
  return {
    vialMg: normalizedVialMg,
    vialMl: normalizedVialMl,
    doseMg: normalizedDoseMg,
    syringeCapacity: normalizedCapacity,
    concentration,
    volumeMl,
    units,
    percentage: (units / normalizedCapacity) * 100
  };
}

function resetSimulation() {
  $('vial-mg').value = initialSimulation.vialMg;
  $('vial-ml').value = initialSimulation.vialMl;
  $('dose-mg').value = initialSimulation.doseMg;
  $('medicine').value = initialSimulation.medicine;
  document.querySelectorAll('[name="capacity"]').forEach((element) => {
    element.checked = element.value === initialSimulation.syringeCapacity;
  });
  update();
}

window.DoseCalculator = Object.freeze({
  calculateDose,
  getCurrentSimulation: () => currentSimulation ? { ...currentSimulation } : null,
  reset: resetSimulation
});

function number(value, digits = 2) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function numberFixed(value, digits) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function percentageLabel(value) {
  return value === 0 ? numberFixed(value, 0) : number(value, 1);
}

function resultNumber(value, digits) {
  return value === 0 ? numberFixed(value, digits) : number(value, digits);
}

function renderTicks(capacity) {
  const ticks = $('ticks');
  ticks.replaceChildren();
  const step = capacity === 100 ? 2 : 1;
  const count = capacity / step;
  const majorEvery = capacity === 100 ? 10 : 5;
  const innerTop = 45;
  const majorTickY2 = 55;
  const minorTickY2 = 50;
  const labelY = 69.5;
  const fontSize = capacity === 100 ? '10.5' : '12';
  const strokeWidth = capacity === 100 ? '2.3' : '2.7';

  for (let i = 0; i <= count; i++) {
    const value = i * step;
    const x = syringeEnd - (value / capacity) * (syringeEnd - syringeStart);
    const major = value % majorEvery === 0;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x); line.setAttribute('x2', x);
    line.setAttribute('y1', innerTop); line.setAttribute('y2', major ? majorTickY2 : minorTickY2);
    line.setAttribute('stroke', '#162e2c');
    line.setAttribute('stroke-width', major ? 1.25 : 0.85);
    ticks.appendChild(line);

    if (major && value > 0 && value <= capacity) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', x);
      label.setAttribute('y', labelY);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#0e2926');
      label.setAttribute('stroke', '#ffffff');
      label.setAttribute('stroke-width', strokeWidth);
      label.setAttribute('stroke-linejoin', 'round');
      label.setAttribute('stroke-linecap', 'round');
      label.setAttribute('paint-order', 'stroke fill');
      label.setAttribute('font-size', fontSize);
      label.setAttribute('font-family', "'DM Sans', sans-serif");
      label.setAttribute('font-weight', '800');
      label.classList.add('tick-label');
      label.textContent = value;
      ticks.appendChild(label);
    }
  }
}

function renderSyringeResult({ capacity, units, volume, percentage }) {
  const displayPercentage = Math.min(100, Math.max(0, percentage));
  const markerX = syringeEnd - (displayPercentage / 100) * (syringeEnd - syringeStart);
  const liquidWidth = syringeEnd - markerX;
  const stopperWidth = 18;
  const stopperX = markerX - stopperWidth;
  const rodEnd = Math.max(34, stopperX);

  $('units-value').textContent = resultNumber(units, 2);
  $('ml-value').textContent = `${resultNumber(volume, 3)} mL`;
  $('capacity-text').textContent = `${percentageLabel(percentage)}% da seringa de ${capacity} UI`;
  $('capacity-fill').style.width = `${displayPercentage}%`;

  const liquidEl = $('liquid');
  if (liquidEl) {
    liquidEl.setAttribute('x', markerX);
    liquidEl.setAttribute('width', liquidWidth);
  }

  const plungerStop = $('plunger-stop');
  if (plungerStop) {
    plungerStop.setAttribute('transform', `translate(${stopperX}, 0)`);
    plungerStop.setAttribute('x', stopperX);
  }

  const plungerRod = $('plunger-rod');
  if (plungerRod) {
    plungerRod.setAttribute('d', `M34 54H${rodEnd}v12H34Z`);
  }
  const plungerRodRib = $('plunger-rod-rib');
  if (plungerRodRib) {
    plungerRodRib.setAttribute('x2', rodEnd);
  }
  const plungerRodHi = $('plunger-rod-rib-hi');
  if (plungerRodHi) {
    plungerRodHi.setAttribute('x2', rodEnd);
  }

  const doseMarker = $('dose-marker');
  if (doseMarker) {
    doseMarker.setAttribute('x1', markerX);
    doseMarker.setAttribute('x2', markerX);
  }

  const markerArrow = $('marker-arrow');
  if (markerArrow) {
    markerArrow.setAttribute('d', `M${markerX} 33l-6 -11h12Z`);
  }

  $('syringe').setAttribute('aria-label', `Seringa preenchida até ${resultNumber(units, 2)} unidades`);
}

function renderZeroResult(capacity) {
  renderSyringeResult({ capacity, units: 0, volume: 0, percentage: 0 });
  $('calc-concentration').textContent = '—';
  $('calc-volume').textContent = '—';
  $('calc-units').textContent = '—';
  renderTicks(capacity);
}

function update() {
  const vialMg = parseFloat($('vial-mg').value);
  const vialMl = parseFloat($('vial-ml').value);
  const doseMg = parseFloat($('dose-mg').value);
  const capacity = parseFloat(document.querySelector('[name="capacity"]:checked').value);
  const medicine = $('medicine').value;
  const error = $('form-error');
  const calculation = medicine ? calculateDose({ vialMg, vialMl, doseMg, syringeCapacity: capacity }) : null;
  error.hidden = Boolean(calculation);
  if (!calculation) {
    currentSimulation = null;
    document.dispatchEvent(new CustomEvent('dosecerta:simulation', { detail: null }));
    error.textContent = 'Selecione o medicamento e preencha todos os valores com números maiores que zero.';
    renderZeroResult(capacity);
    return;
  }

  const { concentration, volumeMl: volume, units, percentage } = calculation;
  const medicineOption = $('medicine').selectedOptions[0];
  currentSimulation = {
    ...calculation,
    medicine: medicineOption.textContent.trim()
  };
  document.dispatchEvent(new CustomEvent('dosecerta:simulation', { detail: { ...currentSimulation } }));
  renderSyringeResult({ capacity, units, volume, percentage });

  $('calc-concentration').textContent = `${number(vialMg)} mg ÷ ${number(vialMl)} mL = ${number(concentration)} mg/mL`;
  $('calc-volume').textContent = `${number(doseMg)} mg ÷ ${number(concentration)} mg/mL = ${number(volume, 3)} mL`;
  $('calc-units').textContent = `${number(volume, 3)} mL × 100 = ${number(units)} UI`;

  const warning = $('warning');
  const warningText = warning.querySelector('p');
  warningText.replaceChildren();
  const warningTitle = document.createElement('strong');
  const lineBreak = document.createElement('br');
  if (units > capacity) {
    warning.classList.add('danger');
    warningTitle.textContent = 'A quantidade ultrapassa esta seringa';
    warningText.append(warningTitle, lineBreak, `${number(units)} UI excedem a capacidade de ${capacity} UI. Não divida aplicações nem troque de seringa sem orientação profissional.`);
  } else {
    warning.classList.remove('danger');
    warningTitle.textContent = 'Confira antes de aplicar';
    const u100 = document.createElement('b');
    u100.textContent = 'U-100';
    warningText.append(warningTitle, lineBreak, 'Use apenas seringa de insulina ', u100, '. Confirme a apresentação do frasco e a dose com um profissional de saúde.');
  }
  renderTicks(capacity);
}

inputs.forEach(id => $(id).addEventListener('input', update));
document.querySelectorAll('[name="capacity"]').forEach(el => el.addEventListener('change', update));
$('medicine').addEventListener('change', update);
document.addEventListener('dosecerta:signup-gate-cancelled', () => resetSimulation());
update();
