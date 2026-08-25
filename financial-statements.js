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
    const other = expenses.filter(t => !isFeed(t) && !isUtility(t) && !isLabor(t) && !isVet(t) && !isInterest(t) && !isMortality(t) && isOperating(t)).reduce((sum, t) => sum + t.amount, 0);
    const operatingExpenses = feed + utilities + labor + vet + interest + mortalityExpense + other;
    const totalIncome = earnedIncome.reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0) + Math.max(0, mortality.loss - txMortality);
    return { tx, expenses, income, earnedIncome, customerDeposits, depositCash, grossSales, collected, receivables, customerCredit, feed, utilities, labor, vet, interest, mortalityExpense, other, operatingExpenses, totalIncome, totalExpense, netProfit: grossSales - operatingExpenses, mortality };
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

  function bookValue(items, quantityFields) {
    return (items || []).reduce((sum, item) => {
      const quantity = num(quantityFields.reduce((value, key) => value || num(item[key]), 0));
      const value = num(item.book_value || item.purchase_price || item.unit_value || item.unit_price || item.price);
      return sum + quantity * value;
    }, 0);
  }

  function balanceSheet(farm, summary, cash) {
    const inventory = inventoryValue(farm);
    // Opening cash is not yet stored as a farm field, so the recorded snapshot
    // uses the cash-flow net change from an assumed zero opening balance. This
    // keeps the Balance Sheet cash equal to the Statement of Cash Flows and
    // excludes non-cash mortality adjustments.
    const cashBalance = cash.netChange;
    const biological = bookValue(farm.sows, ['book_value', 'purchase_price', 'unit_value']) + bookValue(farm.boars, ['book_value', 'purchase_price', 'unit_value']) + bookValue(farm.piglets, ['book_value', 'unit_value', 'unit_price']);
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
    panel.innerHTML = `<div class="finance-report-head"><div><div class="eyebrow">INDUSTRIAL HOG FARM FINANCIAL STATEMENTS</div><h2>Financial statement center</h2><p class="muted">${escF(farm.name || 'Active farm')} · ${monthLabel(current.key)} reporting view · recorded values only</p></div><button type="button" class="btn" onclick="printFinancialStatement()">🖨 Print / Save PDF</button></div><div class="finance-data-guide panel"><b>How this report collects data</b><span><strong>Automatic:</strong> feed deliveries → Feed / COGS; mortality entries → biological mortality loss; reservation/POS/semen receipts → income when the feature creates a transaction.</span><span><strong>Manual:</strong> utilities, labor, debt/interest, capital purchases, loans, equity contributions, and owner draws must be recorded as transactions with a clear type and category.</span><span><strong>Reporting scope:</strong> Profit &amp; Loss and Cash Flows cover the <b>current month</b> (${monthLabel(current.key)}); the Balance Sheet is an all-time snapshot. Feed / COGS includes every Feed expense transaction <b>plus</b> Feed-Orders deliveries that were never booked as transactions.</span><span><strong>Feed costing:</strong> ${summary.feedAccountingMode === 'allocated_cogs' ? 'Feed / COGS uses actual feed allocations multiplied by weighted-average delivery cost (allocations cover ≥50% of this period’s deliveries).' : 'Feed purchases are expensed as delivered; actual-consumption COGS applies once you allocate most of the period’s feed to batches.'}</span></div><div class="finance-kpi-grid"><div class="panel metric"><small>Gross sales / earned revenue</small><b>${money(summary.grossSales)}</b><span>earned operating sales</span></div><div class="panel metric"><small>Actual collected</small><b>${money(summary.collected)}</b><span>cash against earned sales</span></div><div class="panel metric"><small>Net cash movement</small><b class="${cash.netChange < 0 ? 'bad' : ''}">${money(cash.netChange)}</b><span>operating + investing + financing</span></div><div class="panel metric"><small>Mortality loss</small><b class="${summary.mortality.loss > 0 ? 'bad' : ''}">${money(summary.mortality.loss)}</b><span>${summary.mortality.heads} head recorded</span></div><div class="panel metric"><small>Receivables</small><b>${money(summary.receivables)}</b><span>uncollected sales + open reservation &amp; reseller balances</span></div></div><div class="finance-chart-grid"><div class="panel finance-chart-card"><div class="finance-card-head"><div><h3>Monthly operating trend</h3><p class="muted">Revenue, expenses, and cash movement</p></div></div>${barChart(monthRows)}</div><div class="panel finance-chart-card"><div class="finance-card-head"><div><h3>Expense mix</h3><p class="muted">Click a category to highlight matching transactions below.</p></div></div>${pieChart(summary)}</div></div><div class="finance-statements-grid"><div class="panel finance-statement-card"><h3>Income Statement · Profit &amp; Loss <small class="muted" style="font-size:11px">· ${monthLabel(current.key)}</small></h3>${statementRows([['Operating revenue', summary.grossSales],['Feed / COGS', -summary.feed],['Gross profit', summary.grossSales - summary.feed, 'total'],['Veterinary / Medicine', -summary.vet],['Utilities', -summary.utilities],['Labor', -summary.labor],['Mortality loss · non-cash biological adjustment', -summary.mortalityExpense],['Debt interest', -summary.interest],['Other operating expenses', -summary.other],['Net operating profit', summary.grossSales - summary.operatingExpenses, 'grand']])}</div><div class="panel finance-statement-card"><h3>Statement of Cash Flows <small class="muted" style="font-size:11px">· ${monthLabel(current.key)}</small></h3><div class="finance-subhead">Operating activities</div>${statementRows([['Cash received from operations', cash.operatingIn],['Cash paid for operations', -cash.operatingOut],['Net operating cash flow', cash.operating, 'total']])}<div class="finance-subhead">Investing activities</div>${statementRows([['Asset/equipment sales', cash.investingIn],['Breeding stock / facility / equipment purchases', -cash.investingOut],['Net investing cash flow', cash.investing, 'total']])}<div class="finance-subhead">Financing activities</div>${statementRows([['Loans / revolving credit received', cash.loanIn],['Equity contributions', cash.equityIn],['Principal / debt repayments', -cash.principalOut],['Equity draws / dividends', -cash.equityOut],['Net financing cash flow', cash.financing, 'total'],['Net change in cash', cash.netChange, 'grand']])}<p class="finance-note">Mortality loss is shown in Profit &amp; Loss but excluded from cash outflows unless an actual cash transaction was recorded.</p></div><div class="panel finance-statement-card"><h3>Balance Sheet · Recorded Snapshot <small class="muted" style="font-size:11px">· all-time</small></h3><div class="finance-subhead">Assets</div>${statementRows([['Cash and cash equivalents', balance.assets.cash],['Accounts receivable & open customer balances', balance.assets.receivables],['Feed inventory', balance.assets.feed],['Semen inventory', balance.assets.semen],['Biological assets · recorded book values', balance.assets.biological],['Total assets', balance.totalAssets, 'grand']])}<div class="finance-subhead">Liabilities &amp; equity</div>${statementRows([['Accounts payable', balance.liabilities.accountsPayable],['Customer deposits held', balance.liabilities.customerDeposits],['Recorded debt balance proxy', balance.liabilities.debt],['Total liabilities', balance.totalLiabilities, 'total'],['Owner equity / balancing figure', balance.equity, 'grand']])}<p class="finance-note">Opening cash is not stored yet, so cash assumes a zero opening balance and equals the modeled net cash change. Biological assets include only explicit book value, purchase price, or unit value fields; no market valuation is invented.</p></div></div><div class="panel finance-mom-card"><div class="finance-card-head"><div><h3>MoM strategic value tracking</h3><p class="muted">${monthLabel(previous.key)} versus ${monthLabel(current.key)} · 20% movements are flagged for review</p></div></div><div class="table-wrap"><table class="table finance-mom-table"><thead><tr><th>Metric</th><th>Previous</th><th>Current</th><th>Change</th></tr></thead><tbody>${momTable}</tbody></table></div><div class="finance-mom-notes"><span>⚠ Early defect detection: feed, utilities, and veterinary spikes are flagged.</span><span>💧 Liquidity: monitor net cash movement before grow-out cash bottlenecks.</span><span>🌾 Input volatility: feed cost is tracked as the primary operating cost.</span></div></div>`;
    host.prepend(panel);
  }

  function highlightFinancialCategory(category) {
    const panel = document.getElementById('financialStatementPanel');
    if (!panel) return;
    panel.dataset.highlightCategory = category;
    panel.querySelectorAll('.finance-mom-table tr').forEach(row => row.classList.toggle('finance-highlight', row.textContent.includes(category)));
    setTimeout(() => { if (panel.dataset.highlightCategory === category) delete panel.dataset.highlightCategory; }, 3500);
  }

  function printFinancialStatement() {
    const panel = document.getElementById('financialStatementPanel');
    if (!panel) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) { toast('Please allow pop-ups to print the financial statement.'); return; }
    printWindow.document.write(`<!doctype html><html><head><title>Financial Statements - ARSwineTech Pro</title><style>body{font-family:Arial,sans-serif;color:#172327;margin:24px}h2,h3{margin:0 0 8px}.muted,.finance-note{color:#637174;font-size:11px}.finance-report-head{display:flex;justify-content:space-between;border-bottom:2px solid #1aa89f;padding-bottom:12px;margin-bottom:14px}.finance-kpi-grid,.finance-chart-grid,.finance-statements-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0}.finance-kpi-grid{grid-template-columns:repeat(4,1fr)}.panel{border:1px solid #cdd9da;border-radius:8px;padding:12px}.metric{display:grid;gap:3px}.metric b{font-size:18px;color:#067f77}.finance-statement-row{display:flex;justify-content:space-between;border-bottom:1px solid #e6eded;padding:5px 0;font-size:12px}.finance-statement-row.total{font-weight:700;border-top:1px solid #789;margin-top:3px}.finance-statement-row.grand{font-size:14px;font-weight:800;border-top:2px solid #067f77;margin-top:6px}.finance-subhead{font-size:11px;text-transform:uppercase;color:#067f77;font-weight:800;margin-top:12px}.finance-pie-wrap{display:flex;gap:15px;align-items:center}.finance-pie{width:120px;text-align:center}.finance-pie svg{width:110px;height:110px;transform:rotate(-90deg)}.finance-pie strong{display:block}.finance-legend-item{display:flex;gap:6px;border:0;background:none;padding:3px;font-size:10px;width:100%;justify-content:space-between}.finance-legend-item i{width:10px;height:10px;border-radius:50%}.finance-chart svg{width:100%;height:160px}.finance-mom-table{width:100%;border-collapse:collapse;font-size:11px}.finance-mom-table th,.finance-mom-table td{padding:5px;border-bottom:1px solid #dfe8e8;text-align:left}.finance-mom-notes{display:flex;gap:15px;font-size:10px;color:#59696c;margin-top:10px}.bad{color:#c63345!important}@media print{.panel{break-inside:avoid}.finance-chart-card{break-inside:avoid}.finance-statements-grid{grid-template-columns:repeat(3,1fr)}}</style></head><body>${panel.innerHTML}</body></html>`);
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
