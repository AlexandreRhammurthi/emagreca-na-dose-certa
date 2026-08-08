const $ = (id) => document.getElementById(id);
const inputs = ['vial-mg', 'vial-ml', 'dose-mg'];
const syringeStart = 82;
const syringeEnd = 489;

function number(value, digits = 2) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function renderTicks(capacity) {
  const ticks = $('ticks');
  ticks.replaceChildren();
  const step = capacity === 100 ? 2 : 1;
  const count = capacity / step;
  for (let i = 0; i <= count; i++) {
    const value = i * step;
    const x = syringeEnd - (value / capacity) * (syringeEnd - syringeStart);
    const majorEvery = capacity === 100 ? 10 : 5;
    const major = value % majorEvery === 0;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x); line.setAttribute('x2', x);
    line.setAttribute('y1', 49); line.setAttribute('y2', major ? 70 : 61);
    line.setAttribute('stroke-width', major ? 2 : 1);
    ticks.appendChild(line);
    if (major && value < capacity && value > 0) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', x); label.setAttribute('y', 43);
      label.setAttribute('text-anchor', 'middle'); label.setAttribute('fill', '#617773');
      label.setAttribute('font-size', '10'); label.setAttribute('font-family', 'DM Sans');
      label.textContent = value;
      ticks.appendChild(label);
    }
  }
}

function update() {
  const vialMg = parseFloat($('vial-mg').value);
  const vialMl = parseFloat($('vial-ml').value);
  const doseMg = parseFloat($('dose-mg').value);
  const capacity = parseFloat(document.querySelector('[name="capacity"]:checked').value);
  const error = $('form-error');
  const valid = [vialMg, vialMl, doseMg].every(v => Number.isFinite(v) && v > 0);
  error.hidden = valid;
  if (!valid) {
    error.textContent = 'Preencha todos os valores com números maiores que zero.';
    return;
  }

  const concentration = vialMg / vialMl;
  const volume = doseMg / concentration;
  const units = volume * 100;
  const percentage = (units / capacity) * 100;
  const displayPercentage = Math.min(100, Math.max(0, percentage));
  const markerX = syringeEnd - (displayPercentage / 100) * (syringeEnd - syringeStart);
  const liquidWidth = syringeEnd - markerX;

  $('units-value').textContent = number(units);
  $('ml-value').textContent = `${number(volume, 3)} mL`;
  $('capacity-text').textContent = `${number(percentage, 1)}% da seringa de ${capacity} UI`;
  $('capacity-fill').style.width = `${displayPercentage}%`;
  $('liquid').setAttribute('x', markerX);
  $('liquid').setAttribute('width', liquidWidth);
  $('plunger-stop').setAttribute('x', markerX - 12);
  $('plunger-rod').setAttribute('d', `M27 81H${markerX - 11}v28H27`);
  $('dose-marker').setAttribute('x1', markerX); $('dose-marker').setAttribute('x2', markerX);
  $('marker-arrow').setAttribute('d', `M${markerX} 25l-7 9h14Z`);
  $('syringe').setAttribute('aria-label', `Seringa preenchida até ${number(units)} unidades`);

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
update();
