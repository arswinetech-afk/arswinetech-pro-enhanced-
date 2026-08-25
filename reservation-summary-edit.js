(function() {
  function openReservationDetails(i) {
    let r = F().reservations[i],
      b = (F().piglets || []).find(x => x.id === r.batch_id),
      o = r.summary_overrides || {};
    document.body.insertAdjacentHTML('beforeend', `<div class="drill-bg" id="reservationDetail"><div class="drill-panel"><div class="print-brand"><img class="print-app-logo" src="${document.querySelector('.sidebar .logo-img')?.dataset.defaultSrc||document.querySelector('.sidebar .logo-img')?.src||''}"><span><b>AR SWINETECH</b><small>Breed. Feed. Predict.</small></span><em>${F().name}</em><img class="print-farm-logo" src="${document.querySelector('.sidebar .logo-img')?.src||''}"></div><div class="drill-header"><div><div class="eyebrow">ARSWINETECH RESERVATION SUMMARY</div><h2>${r.no}</h2></div><div><button class="btn ghost" onclick="window.print()">Print / PDF</button><button class="close-reminder" onclick="document.getElementById('reservationDetail').remove()">×</button></div></div><form onsubmit="event.preventDefault();saveSummaryOverride(${i},this)"><div class="batch-detail-grid"><section><h3>Reservation Information</h3><p><b>Customer</b><input name="customer" value="${o.customer??r.customer}"></p><p><b>Contact</b><input name="contact" value="${o.contact??r.contact??''}"></p><p><b>Address</b><input name="address" value="${o.address??''}"></p><p><b>Status</b><span>${r.status}</span></p></section><section><h3>Batch Information</h3><p><b>Batch</b><span>${b?.id||'N/A'}</span></p><p><b>Breed</b><span>${b?.breed||'N/A'}</span></p><p><b>Sow / Sire</b><span>${b?.dam_name||b?.sow||'—'} / ${b?.sire_name||b?.sire||'—'}</span></p></section><section><h3>Released Piglet Details</h3><p><b>Tag</b><input name="tag" value="${o.tag??r.tag_no??''}"></p><p><b>Weight</b><input name="weight" value="${o.weight??r.weight??''}"></p><p><b>Vaccination</b><input name="vaccination" value="${o.vaccination??r.vaccination_name??''}"></p><p><b>Teat Count</b><input name="teats" value="${o.teats??r.teat_count??''}"></p></section><section><h3>Customer Notes</h3><textarea name="notes">${o.notes??r.notes??''}</textarea></section></div><div class="actions"><button class="btn ghost" type="button" onclick="resetSummaryOverride(${i})">Reset Overrides</button><button class="btn">Save Summary</button></div></form></div></div>`)
  }

  function saveSummaryOverride(i, f) {
    let d = Object.fromEntries(new FormData(f));
    F().reservations[i].summary_overrides = d;
    save();
    toast('Summary saved without changing source transaction')
  }

  function resetSummaryOverride(i) {
    delete F().reservations[i].summary_overrides;
    save();
    document.getElementById('reservationDetail').remove();
    openReservationDetails(i)
  }
  window.openReservationDetails = openReservationDetails;
  window.saveSummaryOverride = saveSummaryOverride;
  window.resetSummaryOverride = resetSummaryOverride
})()