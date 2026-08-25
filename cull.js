(function() {
  function cullSow(i) {
    let s = F().sows[i];
    let reason = document.getElementById('cullReason')?.value || prompt('Cull reason');
    if (!reason) return;
    let price = +document.getElementById('cullPrice')?.value || 0;
    s.culled = true;
    s.status = 'CULLED';
    s.cullDate = new Date().toISOString().slice(0, 10);
    s.cullReason = reason;
    s.cullPrice = price;
    s.culledAt = new Date().toISOString();
    if (reason.toLowerCase() === 'sold' && price)(F().transactions || (F().transactions = [])).push({
      date: s.cullDate,
      type: 'Income',
      category: 'Hog Sales',
      description: `Culled sow ${s.name}`,
      amount: price,
      paid: price
    });
    save();
    renderAll();
    toast('Sow marked CULLED; history preserved')
  };
  window.cullSow = cullSow
})();

function openCullModal(i) {
  let s = F().sows[i];
  document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="cullModal"><form class="due-modal" onsubmit="event.preventDefault();cullSow(${i});document.getElementById('cullModal').remove()"><h2>Cull Sow</h2><p>${s.name} will be removed from active breeding; history remains.</p><div class="field"><label>Reason</label><select id="cullReason"><option>Old Age</option><option>Poor Reproductive Performance</option><option>Health Problem</option><option>Injury</option><option>Disease</option><option>Sold</option><option>Death</option><option>Other</option></select></div><div class="field"><label>Selling Price</label><input id="cullPrice" type="number" value="0"></div><div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('cullModal').remove()">Cancel</button><button class="btn danger-btn">Confirm Cull</button></div></form></div>`)
}
window.openCullModal = openCullModal;