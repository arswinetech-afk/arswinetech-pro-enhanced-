/*
 * ARSwineTech Pro — industrial hog-farm financial statements.
 *
 * Display/report layer only: it reads the active farm's transactions, sales,
 * inventory, herd book values, and mortality ledger. It does not write data.
 * The existing transaction table remains below the statements.
 */
(function () {
  'use strict';

  const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const num = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
  const escF = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const monthOf = value => {
    const raw = String(value || '').slice(0, 10);
    return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : null;
  };
  const monthLabel = key => {
    if (!key) return '—';
    const [year, month] = key.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
  };
  const pctChange = (current, previous) => previous === 0 ? (current === 0 ? 0 : null) : ((current - previous) / Math.abs(previous)) * 100;
  const isoMonth = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

  function financialSignature(t) {
    return `${String(t.date || '').slice(0, 10)}|${num(t.amount).toFixed(2)}|${num(t.paid).toFixed(2)}|${num(t.qty)}|${String(t.product || t.description || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
  }

  function records(farm) {
    const source = Array.isArray(farm.transactions) ? farm.transactions : [];
    const out = [];
    const ids = new Set();
    const signatures = new Set();
    source.filter(t => t && typeof t === 'object' && !['voided', 'deleted', 'undone', 'applied'].includes(String(t.status || '').toLowerCase())).forEach((t, index) => {
      const normalized = { ...t, _index: index, _source: 'transaction', amount: num(t.amount), paid: num(t.paid), month: monthOf(t.date || t.created_at) || isoMonth(new Date()) };
      if (normalized.id) ids.add(String(normalized.id));
      signatures.add(financialSignature(normalized));
      out.push(normalized);
    });

    // f.sales is a legacy/POS mirror. Include only sales that do not already
    // have a matching transaction, preventing revenue/collection double count.
    (farm.sales || []).filter(s => s && typeof s === 'object').forEach((sale, index) => {
      const saleId = String(sale.id || sale.pos_id || '').trim();
      const signature = financialSignature({ date: sale.date, amount: sale.total || sale.amount, paid: sale.paid, qty: sale.qty, product: sale.product });
      if ((saleId && ids.has(saleId)) || signatures.has(signature)) return;
      const normalized = {
        ...sale, id: saleId || `sales-${index}`, _index: index, _source: 'sales_mirror_fallback',
        type: 'Income', category: sale.category || 'POS Sales', description: sale.product || 'POS sale',
        amount: num(sale.total || sale.amount), paid: num(sale.paid), month: monthOf(sale.date || sale.created_at) || isoMonth(new Date())
      };
      out.push(normalized);
      signatures.add(signature);
    });
    return out;
  }

  /* [REBUILD FIX 78] deliveries booked in Feed Orders before the expense-tx
     feature (or on builds that missed it) must still reach the statements.
     Synthesize an Expense row for any delivery that has no matching Feed
     transaction on the same date & amount. */
  function syntheticDeliveries(farm) {
    const txs = Array.isArray(farm.transactions) ? farm.transactions : [];
    const out = [];
    (farm.feedOrders || []).forEach(o => {
      (o.deliveries || []).forEach(d => {
        const amt = num(d.amount);
        const dDate = String(d.date || '').slice(0, 10);
        if (!dDate || amt <= 0) return;
        const hit = txs.some(t => t && t.type === 'Expense' && /feed|ration|corn|maize/i.test(`${t.category || ''} ${t.description || ''}`) && String(t.date || '').slice(0, 10) === dDate && Math.abs(num(t.amount) - amt) < 0.01);
        if (!hit) out.push({ id: 'synfd-' + (d.id || Math.random()), date: dDate, type: 'Expense', category: 'Feed', description: `Feed delivery — ${o.feed_type || 'feed'} × ${d.bags || ''} bag(s)`, amount: amt, paid: amt, month: monthOf(dDate) || isoMonth(new Date()), _source: 'feed_orders' });
      });
    });
    return out;
  }

  function textOf(t) { return `${t.category || ''} ${t.description || ''}`.toLowerCase(); }

  /* [REBUILD FIX 79] reservations that are not released yet have NO income
     transaction, so their unpaid balances never reached "Receivables". Add
     every open (non-cancelled, non-released) reservation balance; released
     ones are already carried by their release income row. */
  function openReservationBalances(farm) {
    return (farm.reservations || []).reduce((sum, r) => {
      if (!r || ['cancelled', 'released'].includes(String(r.status || '').toLowerCase())) return sum;
      const bal = num(r.balance !== undefined && r.balance !== null ? r.balance : num(r.total) - num(r.paid));
      return sum + Math.max(0, bal);
    }, 0);
  }

  /* [FIX M4] the old matcher required the description to contain the
     reservation "no id" string joined together, so it could NEVER match (release
     descriptions carry only the reservation number) — deposits stayed "held"
     forever and cash double-counted at release. Match no OR id separately. */
  function depositReservation(t, farm) {
    const text = textOf(t);
    if (!/reservation prepayment|floating reservation deposit|customer deposit/.test(text)) return null;
    const parts = (r) => [r.no, r.id].filter(Boolean).map(x => String(x).toLowerCase().trim()).filter(Boolean);
    return (farm.reservations || []).find(r => r && parts(r).some(p => text.includes(p))) || null;
  }
  function isCustomerDeposit(t, farm) {
    const text = textOf(t);
    if (!/reservation prepayment|floating reservation deposit|customer deposit/.test(text)) return false;
    const reservation = depositReservation(t, farm);
    // Held liability only while the reservation is still open/floating; a
    // released reservation is recognized by its release entry (and the
    // prepayment is marked 'applied'), a cancelled one was refunded. Legacy
    // deposits without a matching reservation stay held (never counted twice).
    return reservation ? !['released', 'cancelled'].includes(String(reservation.status || '').toLowerCase()) : true;
  }
  function isAppliedDeposit(t, farm) {
    const reservation = depositReservation(t, farm);
    return Boolean(reservation) && ['released', 'cancelled'].includes(String(reservation.status || '').toLowerCase());
  }
  function isMortality(t) { return /mortality|death|livestock loss|piglet loss/.test(textOf(t)); }
  /* [REBUILD FIX 101] purchased piglets / weaners — its own P&L line */
  function isPigletPurchase(t) { return /piglet purchase|purchased piglets|weaner purchase|bought piglets/.test(textOf(t)); }
  function isFeed(t) { return /feed|ration|corn|maize|soy|ingredient|premix/.test(textOf(t)); }
  function isUtility(t) { return /utility|electric|electricity|water|power|fuel|diesel|internet|telephone|phone/.test(textOf(t)); }
  function isLabor(t) { return /labor|labour|wage|salary|payroll|worker|staff/.test(textOf(t)); }
  function isVet(t) { return /medicine|medication|veterinary|vet|vaccine|vaccination|treatment|drug/.test(textOf(t)); }
  function isInterest(t) { return /interest|finance charge|bank charge/.test(textOf(t)); }
  function isLoanIn(t) { return t.type === 'Income' && /loan|credit line|revolving credit|financing|capital loan/.test(textOf(t)); }
  function isEquityIn(t) { return t.type === 'Income' && /equity|owner contribution|capital contribution|shareholder/.test(textOf(t)); }
  function isFinancingOut(t) { return t.type === 'Expense' && /principal|loan repayment|debt repayment|equity draw|owner draw|dividend/.test(textOf(t)); }
  function isInvesting(t) { return /breeding stock|breeding sow|boar purchase|barn|facility|equipment|machinery|automation|capital expenditure|capex|land|building|vehicle|cull|equipment sale/.test(textOf(t)); }
  function isOperating(t) { return !isLoanIn(t) && !isEquityIn(t) && !isFinancingOut(t) && !isInvesting(t); }

  function expenseCategory(t) {
    if (isPigletPurchase(t)) return 'Piglet Purchases';
    if (isMortality(t)) return 'Mortality Loss';
    if (isFeed(t)) return 'Feed / COGS';
    if (isUtility(t)) return 'Utilities';
    if (isLabor(t)) return 'Labor';
    if (isVet(t)) return 'Veterinary / Medicine';
    if (isInterest(t)) return 'Debt Interest';
    return 'Other Operating';
  }

  function mortalityLedger(farm) {
    return (farm.pigletLedger || []).filter(x => x && x.type === 'mortality' && !['undone', 'deleted', 'voided'].includes(String(x.status || '').toLowerCase()));
  }

  function mortalitySummary(farm) {
    const rows = mortalityLedger(farm);
    const heads = rows.reduce((sum, row) => sum + num(row.quantity), 0);
    const loss = rows.reduce((sum, row) => sum + (num(row.total_loss) || num(row.quantity) * num(row.unit_price)), 0);
    return { rows, heads, loss };
  }

  function transactionSummary(farm, monthKey) {
    /* [FIX M4] deposits applied to a released/cancelled reservation never enter
       the operating figures (the release entry is the revenue) and no longer sit
       in the held-liabilities bucket either. */
    /* [REBUILD FIX 78] optional month scoping + synthesized feed deliveries */
    const allTx = records(farm).concat(syntheticDeliveries(farm));
    const appliedDeposits = allTx.filter(t => t.type === 'Income' && isAppliedDeposit(t, farm));
    let tx = allTx.filter(t => !appliedDeposits.includes(t));
    if (monthKey) tx = tx.filter(t => (t.month || monthOf(t.date || t.created_at)) === monthKey);
    const mortality = mortalitySummary(farm);
    const expenses = tx.filter(t => t.type === 'Expense');
    const income = tx.filter(t => t.type === 'Income');
    const customerDeposits = income.filter(t => isCustomerDeposit(t, farm));
    const earnedIncome = income.filter(t => !isCustomerDeposit(t, farm));
    const operatingIncome = earnedIncome.filter(isOperating);
    const grossSales = operatingIncome.reduce((sum, t) => sum + t.amount, 0);
    const collected = operatingIncome.reduce((sum, t) => sum + t.paid, 0);
    const depositCash = customerDeposits.reduce((sum, t) => sum + t.paid, 0);
    const receivables = Math.max(0, grossSales - collected) + openReservationBalances(farm);
    const customerCredit = Math.max(0, collected - grossSales);
    const feed = expenses.filter(isFeed).reduce((sum, t) => sum + t.amount, 0);
    const utilities = expenses.filter(isUtility).reduce((sum, t) => sum + t.amount, 0);
    const labor = expenses.filter(isLabor).reduce((sum, t) => sum + t.amount, 0);
    const vet = expenses.filter(isVet).reduce((sum, t) => sum + t.amount, 0);
    const interest = expenses.filter(isInterest).reduce((sum, t) => sum + t.amount, 0);
    const txMortality = expenses.filter(isMortality).reduce((sum, t) => sum + t.amount, 0);
    const mortalityExpense = Math.max(txMortality, mortality.loss);
    const pigletPurch = expenses.filter(isPigletPurchase).reduce((sum, t) => sum + t.amount, 0); /* [FIX 101] */
    const other = expenses.filter(t => !isFeed(t) && !isUtility(t) && !isLabor(t) && !isVet(t) && !isInterest(t) && !isMortality(t) && !isPigletPurchase(t) && isOperating(t)).reduce((sum, t) => sum + t.amount, 0);
    const operatingExpenses = feed + utilities + labor + vet + interest + mortalityExpense + pigletPurch + other;
    const totalIncome = earnedIncome.reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0) + Math.max(0, mortality.loss - txMortality);
    return { tx, expenses, income, earnedIncome, customerDeposits, depositCash, grossSales, collected, receivables, customerCredit, feed, utilities, labor, vet, interest, mortalityExpense, pigletPurch, other, operatingExpenses, totalIncome, totalExpense, netProfit: grossSales - operatingExpenses, mortality };
  }

  function cashFlow(summary) {
    const operatingIn = summary.income.filter(t => isOperating(t)).reduce((sum, t) => sum + t.paid, 0);
    const operatingOut = summary.expenses.filter(t => isOperating(t) && !isMortality(t)).reduce((sum, t) => sum + t.paid, 0);
    const investingIn = summary.income.filter(t => isInvesting(t)).reduce((sum, t) => sum + t.paid, 0);
    const investingOut = summary.expenses.filter(t => isInvesting(t)).reduce((sum, t) => sum + t.paid, 0);
    const loanIn = summary.income.filter(isLoanIn).reduce((sum, t) => sum + t.paid, 0);
    const equityIn = summary.income.filter(isEquityIn).reduce((sum, t) => sum + t.paid, 0);
    const principalOut = summary.expenses.filter(t => isFinancingOut(t) && /principal|loan|debt/.test(textOf(t))).reduce((sum, t) => sum + t.paid, 0);
    const equityOut = summary.expenses.filter(t => isFinancingOut(t) && /equity|owner draw|dividend/.test(textOf(t))).reduce((sum, t) => sum + t.paid, 0);
    const financingIn = loanIn + equityIn;
    const financingOut = principalOut + equityOut;
    const operating = operatingIn - operatingOut;
    const investing = investingIn - investingOut;
    const financing = financingIn - financingOut;
    return { operatingIn, operatingOut, operating, investingIn, investingOut, investing, loanIn, equityIn, principalOut, equityOut, financingIn, financingOut, financing, netChange: operating + investing + financing };
  }

  function inventoryValue(farm) {
    const feed = (farm.feed || []).reduce((sum, x) => sum + num(x.bags || x.quantity) * num(x.price || x.unit_price), 0);
    const semen = (farm.semen || []).reduce((sum, x) => sum + num(x.available_bottles ?? x.bottles) * num(x.price || x.unit_price), 0);
    return { feed, semen };
  }

  function bookValue(items, kind) {
    /* [REBUILD FIX 103] the old version read the PRICE field as the QUANTITY,
       squaring purchase prices into absurd totals (₱100,000 boar → ₱10B).
       One sow/boar record = one animal; purchased piglet batches =
       heads × price-per-head. Only explicit value fields count. */
    return (items || []).reduce((sum, item) => {
      if (kind === 'piglets') {
        const perHead = num(item.purchase_price_per_head || item.unit_value || item.book_value);
        const heads = (+item.males || 0) + (+item.females || 0);
        return perHead && heads ? sum + perHead * heads : sum;
      }
      const value = num(item.book_value || item.purchase_price || item.unit_value);
      return value ? sum + value : sum;
    }, 0);
  }

  function balanceSheet(farm, summary, cash) {
    const inventory = inventoryValue(farm);
    // Opening cash is not yet stored as a farm field, so the recorded snapshot
    // uses the cash-flow net change from an assumed zero opening balance. This
    // keeps the Balance Sheet cash equal to the Statement of Cash Flows and
    // excludes non-cash mortality adjustments.
    const cashBalance = cash.netChange;
    const biological = bookValue(farm.sows, 'sows') + bookValue(farm.boars, 'boars') + bookValue(farm.piglets, 'piglets');
    const assets = { cash: cashBalance, receivables: summary.receivables, feed: inventory.feed, semen: inventory.semen, biological };
    const liabilities = { accountsPayable: summary.expenses.reduce((sum, t) => sum + Math.max(0, t.amount - t.paid), 0), customerDeposits: summary.depositCash, debt: Math.max(0, cash.loanIn - cash.principalOut) };
    const totalAssets = Object.values(assets).reduce((sum, value) => sum + value, 0);
    const totalLiabilities = Object.values(liabilities).reduce((sum, value) => sum + value, 0);
    return { assets, liabilities, totalAssets, totalLiabilities, equity: totalAssets - totalLiabilities };
  }

  function months(summary, count = 6) {
    const now = new Date();
    const keys = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(isoMonth(d));
    }
    const by = Object.fromEntries(keys.map(key => [key, { key, revenue: 0, expenses: 0, feed: 0, utilities: 0, vet: 0, labor: 0, cash: 0 }]));
    summary.tx.forEach(t => {
      if (!by[t.month]) return;
      if (t.type === 'Income') by[t.month].revenue += t.amount;
      if (t.type === 'Expense') {
        by[t.month].expenses += t.amount;
        if (isFeed(t)) by[t.month].feed += t.amount;
        if (isUtility(t)) by[t.month].utilities += t.amount;
        if (isVet(t)) by[t.month].vet += t.amount;
        if (isLabor(t)) by[t.month].labor += t.amount;
      }
      by[t.month].cash += t.type === 'Income' ? t.paid : -t.paid;
    });
    return keys.map(key => by[key]);
  }

  function expenseBreakdown(summary) {
    return [
      ['Feed / COGS', summary.feed, '#22d3c5'],
      ['Veterinary / Medicine', summary.vet, '#60a5fa'],
      ['Utilities', summary.utilities, '#fbbf24'],
      ['Labor', summary.labor, '#f472b6'],
      ['Mortality Loss', summary.mortalityExpense, '#fb7185'],
      ['Other Operating', summary.other + summary.interest, '#a78bfa']
    ].filter(x => x[1] > 0);
  }

  let finLast = null; /* [FIX 130] data snapshot for the professional print document */

  function pieChart(summary) {
    const data = expenseBreakdown(summary);
    const total = data.reduce((sum, x) => sum + x[1], 0) || 1;
    let offset = 0;
    const circles = data.map(([label, value, color]) => {
      const pct = (value / total) * 100;
      const circle = `<circle cx="50" cy="50" r="38" fill="none" stroke="${color}" stroke-width="20" pathLength="100" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="${-offset}" class="finance-pie-segment"><title>${escF(label)}: ${money(value)}</title></circle>`;
      offset += pct;
      return circle;
    }).join('');
    const legend = data.map(([label, value, color]) => `<button type="button" class="finance-legend-item" onclick="highlightFinancialCategory('${escF(label)}')"><i style="background:${color}"></i><span>${escF(label)}</span><b>${money(value)}</b></button>`).join('');
    return `<div class="finance-pie-wrap"><div class="finance-pie"><svg viewBox="0 0 100 100" role="img" aria-label="Expense category pie chart">${circles}</svg><strong>${money(total)}</strong><small>tracked expenses</small></div><div class="finance-legend">${legend || '<span class="muted">No categorized expenses yet.</span>'}</div></div>`;
  }

  function barChart(monthRows) {
    const max = Math.max(1, ...monthRows.flatMap(x => [x.revenue, x.expenses, Math.abs(x.cash)]));
    const width = 720, height = 250, left = 42, bottom = 30, chartH = 185, groupW = (width - left - 12) / Math.max(1, monthRows.length);
    const bars = monthRows.map((row, i) => {
      const x = left + i * groupW;
      const values = [[row.revenue, '#22d3c5', 'Revenue'], [row.expenses, '#fb7185', 'Expenses'], [Math.max(0, row.cash), '#60a5fa', 'Net cash']];
      return values.map((v, j) => {
        const h = Math.max(1, (v[0] / max) * chartH);
        const bx = x + j * Math.min(18, groupW / 4);
        return `<rect class="finance-bar" x="${bx.toFixed(1)}" y="${(height - bottom - h).toFixed(1)}" width="${Math.min(14, groupW / 5).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${v[1]}" data-series="${v[2]}"><title>${monthLabel(row.key)} ${v[2]}: ${money(v[0])}</title></rect>`;
      }).join('') + `<text x="${(x + groupW / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" fill="#9bb7b5" font-size="11">${monthLabel(row.key)}</text>`;
    }).join('');
    return `<div class="finance-chart"><div class="finance-chart-legend"><span><i style="background:#22d3c5"></i>Revenue</span><span><i style="background:#fb7185"></i>Expenses</span><span><i style="background:#60a5fa"></i>Net cash</span></div><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Monthly revenue expenses and cash flow">${[0, .25, .5, .75, 1].map(n => `<line x1="${left}" x2="${width - 8}" y1="${height - bottom - n * chartH}" y2="${height - bottom - n * chartH}" stroke="rgba(160,210,205,.16)" stroke-width="1"/>`).join('')}${bars}</svg></div>`;
  }

  function statementRows(entries) {
    return entries.map(([label, value, cls]) => `<div class="finance-statement-row ${cls || ''}"><span>${escF(label)}</span><b>${money(value)}</b></div>`).join('');
  }

  function renderFinancialStatements() {
    const host = document.getElementById('financials');
    if (!host || !document.body.classList.contains('farm-access-granted')) return;
    host.querySelector('#financialStatementPanel')?.remove();
    const farm = F();
    /* [REBUILD FIX 78] P&L + cash flows report the CURRENT month (as the
       header has always claimed); the balance sheet stays an all-time
       snapshot. Feed deliveries without a matching expense transaction are
       synthesized so orders/deliveries always reach Feed / COGS. */
    const curKey = isoMonth(new Date());
    const finSummary = (window.ARSFinance && window.ARSFinance.summary) || transactionSummary;
    const sumAll = finSummary(farm);
    const summary = finSummary(farm, curKey);
    summary.reportMonth = curKey;
    const cash = cashFlow(summary);
    const balance = balanceSheet(farm, sumAll, cashFlow(sumAll));
    const monthRows = months(sumAll);
    const current = monthRows[monthRows.length - 1];
    const previous = monthRows[monthRows.length - 2];
    const momRows = [
      ['Revenue', current.revenue, previous.revenue],
      ['Feed / COGS', current.feed, previous.feed],
      ['Utilities', current.utilities, previous.utilities],
      ['Veterinary / Medicine', current.vet, previous.vet],
      ['Labor', current.labor, previous.labor],
      ['Net cash movement', current.cash, previous.cash]
    ];
    const momTable = momRows.map(([label, cur, prev]) => {
      const change = pctChange(cur, prev);
      const alert = change !== null && Math.abs(change) >= 20;
      return `<tr class="${alert ? 'finance-mom-alert' : ''}"><td>${escF(label)}${alert ? ' <span class="tag warn">Review</span>' : ''}</td><td>${money(prev)}</td><td>${money(cur)}</td><td class="${change !== null && change < 0 && /Revenue|Net cash/.test(label) ? 'bad' : change !== null && change > 0 && /Feed|Utilities|Veterinary|Labor/.test(label) ? 'bad' : 'ok'}">${change === null ? 'New / no prior' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}</td></tr>`;
    }).join('');
    const panel = document.createElement('section');
    panel.id = 'financialStatementPanel';
    panel.className = 'financial-statement-panel';
    finLast = { farm, summary, cash, balance, monthRows, current, previous, momTable }; /* [FIX 130] */
    panel.innerHTML = `<div class="finance-report-head"><div><div class="eyebrow">INDUSTRIAL HOG FARM FINANCIAL STATEMENTS</div><h2>Financial statement center</h2><p class="muted">${escF(farm.name || 'Active farm')} · ${monthLabel(current.key)} reporting view · recorded values only</p></div><button type="button" class="btn" onclick="printFinancialStatement()">🖨 Print / Save PDF</button></div><div class="finance-data-guide panel"><b>How this report collects data</b><span><strong>Automatic:</strong> feed deliveries → Feed / COGS; mortality entries → biological mortality loss; reservation/POS/semen receipts → income when the feature creates a transaction.</span><span><strong>Manual:</strong> utilities, labor, debt/interest, capital purchases, loans, equity contributions, and owner draws must be recorded as transactions with a clear type and category.</span><span><strong>Reporting scope:</strong> Profit &amp; Loss and Cash Flows cover the <b>current month</b> (${monthLabel(current.key)}); the Balance Sheet is an all-time snapshot. Feed / COGS includes every Feed expense transaction <b>plus</b> Feed-Orders deliveries that were never booked as transactions.</span><span><strong>Feed costing:</strong> ${summary.feedAccountingMode === 'allocated_cogs' ? 'Feed / COGS uses actual feed allocations multiplied by weighted-average delivery cost (allocations cover ≥50% of this period’s deliveries).' : 'Feed purchases are expensed as delivered; actual-consumption COGS applies once you allocate most of the period’s feed to batches.'}</span></div><div class="finance-kpi-grid"><div class="panel metric"><small>Gross sales / earned revenue</small><b>${money(summary.grossSales)}</b><span>earned operating sales</span></div><div class="panel metric"><small>Actual collected</small><b>${money(summary.collected)}</b><span>cash against earned sales</span></div><div class="panel metric"><small>Net cash movement</small><b class="${cash.netChange < 0 ? 'bad' : ''}">${money(cash.netChange)}</b><span>operating + investing + financing</span></div><div class="panel metric"><small>Mortality loss</small><b class="${summary.mortality.loss > 0 ? 'bad' : ''}">${money(summary.mortality.loss)}</b><span>${summary.mortality.heads} head recorded</span></div><div class="panel metric"><small>Receivables</small><b>${money(summary.receivables)}</b><span>uncollected sales + open reservation &amp; reseller balances</span></div></div><div class="finance-chart-grid"><div class="panel finance-chart-card"><div class="finance-card-head"><div><h3>Monthly operating trend</h3><p class="muted">Revenue, expenses, and cash movement</p></div></div>${barChart(monthRows)}</div><div class="panel finance-chart-card"><div class="finance-card-head"><div><h3>Expense mix</h3><p class="muted">Click a category to highlight matching transactions below.</p></div></div>${pieChart(summary)}</div></div><div class="finance-statements-grid"><div class="panel finance-statement-card"><h3>Income Statement · Profit &amp; Loss <small class="muted" style="font-size:11px">· ${monthLabel(current.key)}</small></h3>${statementRows([['Operating revenue', summary.grossSales],['Feed / COGS', -summary.feed],['Gross profit', summary.grossSales - summary.feed, 'total'],['Piglet / weaner purchases', -summary.pigletPurch],['Veterinary / Medicine', -summary.vet],['Utilities', -summary.utilities],['Labor', -summary.labor],['Mortality loss · non-cash biological adjustment', -summary.mortalityExpense],['Debt interest', -summary.interest],['Other operating expenses', -summary.other],['Net operating profit', summary.grossSales - summary.operatingExpenses, 'grand']])}</div><div class="panel finance-statement-card"><h3>Statement of Cash Flows <small class="muted" style="font-size:11px">· ${monthLabel(current.key)}</small></h3><div class="finance-subhead">Operating activities</div>${statementRows([['Cash received from operations', cash.operatingIn],['Cash paid for operations', -cash.operatingOut],['Net operating cash flow', cash.operating, 'total']])}<div class="finance-subhead">Investing activities</div>${statementRows([['Asset/equipment sales', cash.investingIn],['Breeding stock / facility / equipment purchases', -cash.investingOut],['Net investing cash flow', cash.investing, 'total']])}<div class="finance-subhead">Financing activities</div>${statementRows([['Loans / revolving credit received', cash.loanIn],['Equity contributions', cash.equityIn],['Principal / debt repayments', -cash.principalOut],['Equity draws / dividends', -cash.equityOut],['Net financing cash flow', cash.financing, 'total'],['Net change in cash', cash.netChange, 'grand']])}<p class="finance-note">Mortality loss is shown in Profit &amp; Loss but excluded from cash outflows unless an actual cash transaction was recorded.</p></div><div class="panel finance-statement-card"><h3>Balance Sheet · Recorded Snapshot <small class="muted" style="font-size:11px">· all-time</small></h3><div class="finance-subhead">Assets</div>${statementRows([['Cash and cash equivalents', balance.assets.cash],['Accounts receivable & open customer balances', balance.assets.receivables],['Feed inventory', balance.assets.feed],['Semen inventory', balance.assets.semen],['Biological assets · recorded book values', balance.assets.biological],['Total assets', balance.totalAssets, 'grand']])}<div class="finance-subhead">Liabilities &amp; equity</div>${statementRows([['Accounts payable', balance.liabilities.accountsPayable],['Customer deposits held', balance.liabilities.customerDeposits],['Recorded debt balance proxy', balance.liabilities.debt],['Total liabilities', balance.totalLiabilities, 'total'],['Owner equity / balancing figure', balance.equity, 'grand']])}<p class="finance-note">Opening cash is not stored yet, so cash assumes a zero opening balance and equals the modeled net cash change. Biological assets include only explicit book value, purchase price, or unit value fields; no market valuation is invented.</p></div></div><div class="panel finance-mom-card"><div class="finance-card-head"><div><h3>MoM strategic value tracking</h3><p class="muted">${monthLabel(previous.key)} versus ${monthLabel(current.key)} · 20% movements are flagged for review</p></div></div><div class="table-wrap"><table class="table finance-mom-table"><thead><tr><th>Metric</th><th>Previous</th><th>Current</th><th>Change</th></tr></thead><tbody>${momTable}</tbody></table></div><div class="finance-mom-notes"><span>⚠ Early defect detection: feed, utilities, and veterinary spikes are flagged.</span><span>💧 Liquidity: monitor net cash movement before grow-out cash bottlenecks.</span><span>🌾 Input volatility: feed cost is tracked as the primary operating cost.</span></div></div>`;
    host.prepend(panel);
  }

  function highlightFinancialCategory(category) {
    const panel = document.getElementById('financialStatementPanel');
    if (!panel) return;
    panel.dataset.highlightCategory = category;
    panel.querySelectorAll('.finance-mom-table tr').forEach(row => row.classList.toggle('finance-highlight', row.textContent.includes(category)));
    setTimeout(() => { if (panel.dataset.highlightCategory === category) delete panel.dataset.highlightCategory; }, 3500);
  }

  /* [REBUILD FIX 130] PROFESSIONAL FINANCIAL STATEMENT DOCUMENT.
     The old print path dumped the on-screen dashboard (dev-facing guide
     paragraph, overlapping chart labels, uneven cards). Owners, lenders and
     investors judge credibility by document presentation, so the PDF is now a
     proper ledger-style report: branded letterhead, executive summary with an
     auto-written insight line, three clean statements, MoM tracking, fixed
     charts, methodology appendix, and a QR-verified footer. */
  function printFinancialStatement() {
    const d = finLast;
    if (!d) { toast('Open the Financial Statement Center first.'); return; }
    const printWindow = window.open('', '_blank');
    if (!printWindow) { toast('Please allow pop-ups to print the financial statement.'); return; }
    const { farm, summary, cash, balance, monthRows, current, previous, momTable } = d;
    const now = new Date();
    const genDate = now.toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' });
    const reportNo = 'ARS-FIN-' + String(current.key).replace(/[^0-9a-z]/gi, '').toUpperCase() + '-' + String(Math.abs((farm.name || '').length * 7919 + summary.grossSales) % 100000).padStart(5, '0');
    const logo = (document.querySelector('.sidebar .logo-img') || {}).src || 'assets/arswinetech-logo.png';
    const netOp = summary.grossSales - summary.operatingExpenses;
    const collectRate = summary.grossSales > 0 ? Math.round((summary.collected / summary.grossSales) * 100) : null;
    const expTotal = summary.operatingExpenses || 0;
    const feedShare = expTotal > 0 ? Math.round((summary.feed / expTotal) * 100) : 0;
    const insight = 'For ' + monthLabel(current.key) + ', ' + escF(farm.name || 'the farm') + ' earned <b>' + money(summary.grossSales) + '</b>' + (collectRate !== null ? ' and collected <b>' + money(summary.collected) + '</b> (' + collectRate + '% collection rate)' : '') + '. Net operating result: <b class="' + (netOp < 0 ? 'bad' : '') + '">' + money(netOp) + '</b>. Largest cost drivers: Feed / COGS ' + money(summary.feed) + ' (' + feedShare + '% of operating expenses)' + (summary.mortality.loss > 0 ? ' and mortality loss ' + money(summary.mortality.loss) + ' (' + summary.mortality.heads + ' head)' : '') + '. Outstanding receivables: ' + money(summary.receivables) + '.';
    const qr = window.generateCertQRCode ? window.generateCertQRCode('ARSWINETECH PRO|FINANCIAL STATEMENTS|' + reportNo + '|' + (farm.name || '') + '|' + current.key, reportNo) : '';

    /* charts, rebuilt for print: spaced labels, calm palette, static legend */
    const max = Math.max(1, ...monthRows.flatMap(x => [x.revenue, x.expenses, Math.abs(x.cash)]));
    const W = 680, H = 200, L = 40, B = 24, CH = 145, gW = (W - L - 8) / Math.max(1, monthRows.length);
    const every = gW < 46 ? 2 : 1;
    const bars = monthRows.map((row, i) => {
      const x = L + i * gW;
      const vals = [[row.revenue, '#1e6b3a', 'Revenue'], [row.expenses, '#b3455b', 'Expenses'], [Math.max(0, row.cash), '#3f7fbf', 'Net cash']];
      const rects = vals.map((v, j) => {
        const h = Math.max(1, (v[0] / max) * CH);
        return '<rect x="' + (x + 4 + j * Math.min(14, gW / 4)).toFixed(1) + '" y="' + (H - B - h).toFixed(1) + '" width="' + Math.min(11, gW / 5).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + v[1] + '"><title>' + monthLabel(row.key) + ' ' + v[2] + ': ' + money(v[0]) + '</title></rect>';
      }).join('');
      const label = i % every === 0 ? '<text x="' + (x + gW / 2).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" font-size="8" fill="#68757a">' + escF(monthLabel(row.key).slice(0, 3)) + '</text>' : '';
      return rects + label;
    }).join('');
    const pieData = expenseBreakdown(summary);
    const pieTotal = pieData.reduce((s, x) => s + x[1], 0) || 1;
    let off = 0;
    const pieSegs = pieData.map(([label, value, color]) => {
      const pct = (value / pieTotal) * 100;
      const c = '<circle cx="50" cy="50" r="38" fill="none" stroke="' + color + '" stroke-width="20" pathLength="100" stroke-dasharray="' + pct.toFixed(2) + ' ' + (100 - pct).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '"/>';
      off += pct;
      return c;
    }).join('');
    const pieLegend = pieData.map(([label, value, color]) => '<div class="lg"><i style="background:' + color + '"></i><span>' + escF(label) + '</span><b>' + money(value) + '</b></div>').join('');

    const stmt = (title, rows) => '<section class="fs-sec"><h3>' + title + '</h3>' + statementRows(rows) + '</section>';

    const body =
      '<header class="fs-head">' +
        '<img src="' + logo + '" alt="logo" onerror="this.style.visibility=\'hidden\'">' +
        '<div class="fs-brand"><b>' + escF(farm.name || 'ARSwineTech Pro') + '</b><small>Industrial Hog Farm Financial Statements</small></div>' +
        '<div class="fs-title"><h1>FINANCIAL STATEMENTS</h1><small>' + escF(monthLabel(current.key)) + ' reporting period &middot; recorded values only</small></div>' +
        '<div class="fs-meta"><div><span>Report No.:</span><b>' + reportNo + '</b></div><div><span>Generated:</span><b>' + genDate + '</b></div><div><span>Prepared by:</span><b>ARSwineTech Pro</b></div></div>' +
      '</header>' +
      '<section class="fs-exec"><h3>Executive Summary</h3><p>' + insight + '</p>' +
        '<div class="fs-kpis">' +
          '<div><small>Gross revenue</small><b>' + money(summary.grossSales) + '</b></div>' +
          '<div><small>Cash collected</small><b>' + money(summary.collected) + '</b></div>' +
          '<div><small>Net operating profit</small><b class="' + (netOp < 0 ? 'bad' : '') + '">' + money(netOp) + '</b></div>' +
          '<div><small>Net cash movement</small><b class="' + (cash.netChange < 0 ? 'bad' : '') + '">' + money(cash.netChange) + '</b></div>' +
          '<div><small>Mortality loss</small><b class="' + (summary.mortality.loss > 0 ? 'bad' : '') + '">' + money(summary.mortality.loss) + '</b><em>' + summary.mortality.heads + ' head</em></div>' +
        '</div>' +
      '</section>' +
      '<div class="fs-cols">' +
        stmt('Income Statement &middot; Profit &amp; Loss &mdash; ' + escF(monthLabel(current.key)), [['Operating revenue', summary.grossSales], ['Feed / COGS', -summary.feed], ['Gross profit', summary.grossSales - summary.feed, 'total'], ['Piglet / weaner purchases', -summary.pigletPurch], ['Veterinary / Medicine', -summary.vet], ['Utilities', -summary.utilities], ['Labor', -summary.labor], ['Mortality loss (non-cash biological adjustment)', -summary.mortalityExpense], ['Debt interest', -summary.interest], ['Other operating expenses', -summary.other], ['Net operating profit', netOp, 'grand']]) +
        stmt('Statement of Cash Flows &mdash; ' + escF(monthLabel(current.key)), [['Cash received from operations', cash.operatingIn], ['Cash paid for operations', -cash.operatingOut], ['Net operating cash flow', cash.operating, 'total'], ['Asset / equipment sales', cash.investingIn], ['Breeding stock & equipment purchases', -cash.investingOut], ['Net investing cash flow', cash.investing, 'total'], ['Loans / credit received', cash.loanIn], ['Equity contributions', cash.equityIn], ['Principal / debt repayments', -cash.principalOut], ['Equity draws / dividends', -cash.equityOut], ['Net financing cash flow', cash.financing, 'total'], ['Net change in cash', cash.netChange, 'grand']]) +
        stmt('Balance Sheet &middot; Recorded Snapshot (all-time)', [['Cash and cash equivalents', balance.assets.cash], ['Accounts receivable & open balances', balance.assets.receivables], ['Feed inventory', balance.assets.feed], ['Semen inventory', balance.assets.semen], ['Biological assets (book value)', balance.assets.biological], ['Total assets', balance.totalAssets, 'grand'], ['Accounts payable', balance.liabilities.accountsPayable], ['Customer deposits held', balance.liabilities.customerDeposits], ['Recorded debt balance', balance.liabilities.debt], ['Total liabilities', balance.totalLiabilities, 'total'], ['Owner equity / balancing figure', balance.equity, 'grand']]) +
      '</div>' +
      '<section class="fs-sec"><h3>Month-over-Month Movement Tracking &mdash; ' + escF(monthLabel(previous.key)) + ' vs ' + escF(monthLabel(current.key)) + '</h3>' +
        '<table class="fs-mom"><thead><tr><th>Metric</th><th>Previous</th><th>Current</th><th>Change</th></tr></thead><tbody>' + momTable + '</tbody></table>' +
        '<p class="fs-small">Movements above 20% are flagged for review. Feed, utilities and veterinary spikes surface early defects; net cash is watched ahead of grow-out bottlenecks; feed cost is tracked as the primary input-volatility driver.</p>' +
      '</section>' +
      '<div class="fs-cols two">' +
        '<section class="fs-sec"><h3>Monthly Operating Trend</h3><div class="fs-legend"><span><i style="background:#1e6b3a"></i>Revenue</span><span><i style="background:#b3455b"></i>Expenses</span><span><i style="background:#3f7fbf"></i>Net cash</span></div><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">' + bars + '</svg></section>' +
        '<section class="fs-sec"><h3>Expense Mix</h3><div class="fs-piewrap"><svg viewBox="0 0 100 100" style="width:110px;height:110px;transform:rotate(-90deg)">' + pieSegs + '</svg><div class="fs-pielegend">' + (pieLegend || '<div class="lg"><span>No categorized expenses yet.</span></div>') + '</div></div></section>' +
      '</div>' +
      '<section class="fs-app"><h3>Appendix A &mdash; Basis of Preparation</h3>' +
        '<p>Automatic postings: feed deliveries &rarr; Feed / COGS; mortality entries &rarr; biological mortality loss; reservation / POS / semen receipts &rarr; income when the source feature creates a transaction. Manual postings: utilities, labor, debt/interest, capital purchases, loans, equity contributions and owner draws. Profit &amp; Loss and Cash Flows cover ' + escF(monthLabel(current.key)) + '; the Balance Sheet is an all-time recorded snapshot. ' + (summary.feedAccountingMode === 'allocated_cogs' ? 'Feed / COGS uses actual allocations multiplied by weighted-average delivery cost.' : 'Feed purchases are expensed as delivered; actual-consumption COGS applies once most of the period&#39;s feed is allocated to batches.') + ' Mortality loss appears in Profit &amp; Loss but is excluded from cash outflows unless an actual cash transaction was recorded. No market valuation is invented.</p>' +
      '</section>' +
      '<footer class="fs-foot"><div class="fs-qr">' + qr + '</div><div><b>' + escF(farm.name || '') + '</b> &middot; Report ' + reportNo + '<br><span>System-generated by ARSwineTech Pro on ' + genDate + ' from recorded values only. Not an audited financial statement.</span></div></footer>';

    printWindow.document.write('<!doctype html><html><head><title>Financial Statements - ' + escF(farm.name || '') + '</title><style>' +
      '@page{size:A4;margin:12mm}body{font-family:Arial,Helvetica,sans-serif;color:#182430;margin:0;font-size:11px}' +
      'h1{font-size:17px;letter-spacing:1.5px;margin:0}h3{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#1e6b3a;border-bottom:1.5px solid #1e6b3a;padding-bottom:3px;margin:0 0 6px}' +
      '.fs-head{display:flex;align-items:center;gap:10px;border-bottom:3px solid #1e6b3a;padding-bottom:8px;margin-bottom:10px}' +
      '.fs-head img{width:40px;height:40px;object-fit:contain}.fs-brand b{font-size:15px;color:#1e6b3a;display:block}.fs-brand small{color:#5c6a76;font-size:8.5px}' +
      '.fs-title{flex:1;text-align:center}.fs-title small{display:block;font-size:9px;color:#5c6a76;margin-top:2px}' +
      '.fs-meta{border:1px solid #b9c4b9;padding:5px 8px;font-size:8.5px;min-width:150px}.fs-meta div{display:flex;justify-content:space-between;gap:8px;padding:1px 0}' +
      '.fs-exec p{margin:4px 0 8px;font-size:10.5px;line-height:1.5}' +
      '.fs-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.fs-kpis div{border:1px solid #cfd8cf;padding:6px;text-align:center}.fs-kpis small{display:block;color:#5c6a76;font-size:8px;text-transform:uppercase;letter-spacing:.4px}.fs-kpis b{font-size:12.5px}.fs-kpis em{display:block;font-style:normal;font-size:8px;color:#5c6a76}' +
      '.fs-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0}.fs-cols.two{grid-template-columns:1.4fr 1fr}' +
      '.fs-sec{border:1px solid #cfd8cf;padding:8px;break-inside:avoid}' +
      '.finance-statement-row{display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid #eef1ee;padding:3px 0;font-size:9.5px}' +
      '.finance-statement-row.total{font-weight:700;border-top:1px solid #89a}.finance-statement-row.grand{font-weight:800;border-top:2px solid #1e6b3a;font-size:10.5px}' +
      '.fs-mom{width:100%;border-collapse:collapse;font-size:9.5px}.fs-mom th,.fs-mom td{border-bottom:1px solid #dfe8e8;padding:4px 5px;text-align:left}.fs-mom td:last-child,.fs-mom th:last-child{text-align:right}' +
      '.fs-small{font-size:8.5px;color:#5c6a76;margin:5px 0 0}' +
      '.fs-legend{display:flex;gap:12px;font-size:8.5px;margin-bottom:4px}.fs-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:3px}' +
      '.fs-piewrap{display:flex;gap:10px;align-items:center}.fs-pielegend{flex:1}.lg{display:flex;align-items:center;gap:5px;font-size:8.5px;padding:2px 0}.lg i{width:9px;height:9px;border-radius:50%}.lg b{margin-left:auto}' +
      '.fs-app p{font-size:8.5px;color:#41505c;line-height:1.5;margin:4px 0 0}' +
      '.fs-foot{display:flex;gap:10px;align-items:center;border-top:2.5px solid #1e6b3a;margin-top:12px;padding-top:8px}.fs-foot span{color:#5c6a76;font-size:8.5px}.fs-qr{width:58px;height:58px;flex:0 0 58px}.fs-qr svg,.fs-qr img{width:58px!important;height:58px!important}' +
      '.bad{color:#c63345!important}' +
      '</style></head><body>' + body + '</body></html>');
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 350);
  }

  window.ARSFinance = { ledger: records, summary: transactionSummary, cashFlow, balanceSheet, expenseBreakdown };

  const oldRenderAll = window.renderAll;
  window.renderAll = function () {
    const result = typeof oldRenderAll === 'function' ? oldRenderAll.apply(this, arguments) : undefined;
    setTimeout(renderFinancialStatements, 0);
    return result;
  };
  window.renderFinancialStatements = renderFinancialStatements;
  window.highlightFinancialCategory = highlightFinancialCategory;
  window.printFinancialStatement = printFinancialStatement;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(renderFinancialStatements, 80));
  else setTimeout(renderFinancialStatements, 80);
})();
